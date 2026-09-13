CREATE FUNCTION marketing_ops_private.can_access_campaign(requested_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketing_ops.campaigns AS campaign
    WHERE campaign.id = requested_campaign_id
      AND campaign.tenant_id = app_private.request_tenant_id()
      AND marketing_ops_private.has_active_membership(campaign.tenant_id)
      AND (
        app_private.request_actor_role() IN ('manager', 'admin')
        OR EXISTS (
          SELECT 1
          FROM marketing_ops.campaign_members AS member
          WHERE member.tenant_id = campaign.tenant_id
            AND member.campaign_id = campaign.id
            AND member.user_id = app_private.request_user_id()
        )
      )
  )
$$;

CREATE FUNCTION marketing_ops_private.can_edit_campaign(requested_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketing_ops.campaigns AS campaign
    WHERE campaign.id = requested_campaign_id
      AND campaign.tenant_id = app_private.request_tenant_id()
      AND campaign.status <> 'archived'
      AND marketing_ops_private.has_active_membership(campaign.tenant_id)
      AND (
        app_private.request_actor_role() IN ('manager', 'admin')
        OR EXISTS (
          SELECT 1
          FROM marketing_ops.campaign_members AS member
          WHERE member.tenant_id = campaign.tenant_id
            AND member.campaign_id = campaign.id
            AND member.user_id = app_private.request_user_id()
            AND member.member_role IN ('owner', 'editor')
        )
      )
  )
$$;

CREATE FUNCTION marketing_ops_private.can_manage_campaign(requested_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketing_ops.campaigns AS campaign
    WHERE campaign.id = requested_campaign_id
      AND campaign.tenant_id = app_private.request_tenant_id()
      AND campaign.status <> 'archived'
      AND marketing_ops_private.has_active_membership(campaign.tenant_id)
      AND (
        app_private.request_actor_role() IN ('manager', 'admin')
        OR EXISTS (
          SELECT 1
          FROM marketing_ops.campaign_members AS member
          WHERE member.tenant_id = campaign.tenant_id
            AND member.campaign_id = campaign.id
            AND member.user_id = app_private.request_user_id()
            AND member.member_role = 'owner'
            AND member.is_primary
        )
      )
  )
$$;

CREATE FUNCTION marketing_ops_private.can_administer_campaign_participants(requested_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT marketing_ops_private.can_edit_campaign(requested_campaign_id)
     AND app_private.request_actor_role() IN ('manager', 'admin')
$$;

CREATE FUNCTION marketing_ops_private.can_access_campaign_item(requested_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketing_ops.campaign_items AS item
    WHERE item.id = requested_item_id
      AND item.tenant_id = app_private.request_tenant_id()
      AND (
        item.assignee_user_id = app_private.request_user_id()
        OR marketing_ops_private.can_access_campaign(item.campaign_id)
      )
  )
$$;

CREATE FUNCTION marketing_ops_private.can_edit_campaign_item(requested_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketing_ops.campaign_items AS item
    JOIN marketing_ops.campaigns AS campaign
      ON campaign.tenant_id = item.tenant_id AND campaign.id = item.campaign_id
    WHERE item.id = requested_item_id
      AND item.tenant_id = app_private.request_tenant_id()
      AND campaign.status <> 'archived'
      AND item.status NOT IN ('completed', 'cancelled')
      AND (
        item.assignee_user_id = app_private.request_user_id()
        OR marketing_ops_private.can_edit_campaign(item.campaign_id)
      )
  )
$$;

CREATE FUNCTION marketing_ops_private.can_edit_content_asset(requested_asset_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM marketing_ops.content_assets AS asset
    WHERE asset.id = requested_asset_id
      AND asset.tenant_id = app_private.request_tenant_id()
      AND marketing_ops_private.can_edit_campaign_item(asset.item_id)
  )
$$;

CREATE FUNCTION marketing_ops_private.promote_first_campaign_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, marketing_ops
AS $$
BEGIN
  IF NEW.member_role = 'owner'
     AND NOT EXISTS (
       SELECT 1 FROM marketing_ops.campaign_members
       WHERE campaign_id = NEW.campaign_id AND member_role = 'owner'
     ) THEN
    NEW.is_primary := true;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER campaign_members_promote_first_owner
BEFORE INSERT ON marketing_ops.campaign_members
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.promote_first_campaign_owner();

CREATE FUNCTION marketing_ops_private.list_campaign_participants(requested_campaign_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  member_role marketing_ops.campaign_member_role,
  is_primary boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, marketing_ops, marketing_ops_private
AS $$
  SELECT member.user_id,
         coalesce(nullif(btrim(principal.full_name), ''), principal.email, 'Member') AS display_name,
         principal.avatar_url,
         member.member_role,
         member.is_primary
  FROM marketing_ops.campaign_members AS member
  JOIN iam.principals AS principal ON principal.id = member.user_id
  WHERE member.campaign_id = requested_campaign_id
    AND member.tenant_id = app_private.request_tenant_id()
    AND marketing_ops_private.can_access_campaign(requested_campaign_id)
  ORDER BY member.is_primary DESC, display_name, member.user_id
$$;

CREATE FUNCTION marketing_ops_private.is_campaign_participant_candidate(
  requested_campaign_id uuid,
  requested_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, marketing_ops, marketing_ops_private
AS $$
  SELECT marketing_ops_private.can_manage_campaign(requested_campaign_id)
     AND EXISTS (
       SELECT 1
       FROM iam.memberships AS membership
       JOIN iam.principals AS principal ON principal.id = membership.principal_id
       WHERE membership.tenant_id = app_private.request_tenant_id()
         AND membership.principal_id = requested_user_id
         AND membership.active
         AND principal.disabled_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM marketing_ops.campaign_members AS member
           WHERE member.campaign_id = requested_campaign_id
             AND member.user_id = requested_user_id
         )
     )
$$;

CREATE FUNCTION marketing_ops_private.list_campaign_participant_candidates(
  requested_campaign_id uuid,
  search_text text DEFAULT NULL,
  result_limit integer DEFAULT 25
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  tenant_role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, marketing_ops, marketing_ops_private
AS $$
  SELECT principal.id,
         coalesce(nullif(btrim(principal.full_name), ''), principal.email, 'Member') AS display_name,
         principal.avatar_url,
         membership.role
  FROM iam.memberships AS membership
  JOIN iam.principals AS principal ON principal.id = membership.principal_id
  WHERE membership.tenant_id = app_private.request_tenant_id()
    AND membership.active
    AND principal.disabled_at IS NULL
    AND marketing_ops_private.can_manage_campaign(requested_campaign_id)
    AND NOT EXISTS (
      SELECT 1 FROM marketing_ops.campaign_members AS member
      WHERE member.campaign_id = requested_campaign_id
        AND member.user_id = principal.id
    )
    AND (
      search_text IS NULL
      OR coalesce(principal.full_name, '') ILIKE '%' || search_text || '%'
      OR coalesce(principal.email, '') ILIKE '%' || search_text || '%'
    )
  ORDER BY display_name, principal.id
  LIMIT least(greatest(result_limit, 1), 100)
$$;

CREATE FUNCTION marketing_ops_private.create_content_version(
  requested_asset_id uuid,
  expected_asset_version bigint,
  version_body text,
  version_metadata jsonb,
  version_hash text,
  freeze_version boolean
)
RETURNS TABLE (
  tenant_id uuid,
  asset_id uuid,
  version_number integer,
  body text,
  metadata jsonb,
  content_hash text,
  frozen_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  asset_version bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
DECLARE
  locked_asset marketing_ops.content_assets%ROWTYPE;
  next_number integer;
BEGIN
  SELECT * INTO locked_asset
  FROM marketing_ops.content_assets AS asset
  WHERE asset.id = requested_asset_id
  FOR UPDATE;

  IF NOT FOUND OR NOT marketing_ops_private.can_edit_content_asset(requested_asset_id) THEN
    RETURN;
  END IF;
  IF locked_asset.version <> expected_asset_version THEN
    RETURN;
  END IF;

  next_number := locked_asset.current_version_number + 1;
  INSERT INTO marketing_ops.content_versions (
    tenant_id, asset_id, version_number, body, metadata, content_hash, frozen_at, created_by
  ) VALUES (
    locked_asset.tenant_id, locked_asset.id, next_number, version_body,
    coalesce(version_metadata, '{}'::jsonb), version_hash,
    CASE WHEN freeze_version THEN transaction_timestamp() ELSE NULL END,
    app_private.request_user_id()
  );

  UPDATE marketing_ops.content_assets
  SET current_version_number = next_number,
      version = version + 1,
      updated_by = app_private.request_user_id()
  WHERE id = locked_asset.id
  RETURNING version INTO asset_version;

  RETURN QUERY
  SELECT content.tenant_id, content.asset_id, content.version_number,
         content.body, content.metadata, content.content_hash, content.frozen_at,
         content.created_by, content.created_at, asset_version
  FROM marketing_ops.content_versions AS content
  WHERE content.asset_id = locked_asset.id AND content.version_number = next_number;
END
$$;

CREATE FUNCTION marketing_ops_private.list_production_schedule(
  range_from timestamptz,
  range_to timestamptz,
  requested_campaign_id uuid,
  requested_kind marketing_ops.item_kind,
  requested_channel marketing_ops.item_channel,
  requested_assignee_id uuid,
  requested_status marketing_ops.item_status,
  requested_priority marketing_ops.item_priority,
  cursor_effective_at timestamptz,
  cursor_priority_rank integer,
  cursor_id uuid,
  result_limit integer
)
RETURNS TABLE (
  id uuid, tenant_id uuid, campaign_id uuid, kind marketing_ops.item_kind,
  title text, description text, content text, status marketing_ops.item_status,
  priority marketing_ops.item_priority, channel marketing_ops.item_channel,
  assignee_user_id uuid, starts_at timestamptz, due_at timestamptz,
  completed_at timestamptz, cancelled_at timestamptz, archived_at timestamptz,
  metadata jsonb, version bigint, created_by uuid, updated_by uuid,
  created_at timestamptz, updated_at timestamptz, campaign_name text,
  effective_at timestamptz, is_overdue boolean, is_blocked boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, marketing_ops, marketing_ops_private
AS $$
  WITH candidates AS (
    SELECT item.*, campaign.name AS campaign_name,
           coalesce(item.starts_at, item.due_at) AS effective_at,
           CASE item.priority
             WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3
           END AS priority_rank,
           item.due_at IS NOT NULL
             AND item.due_at < statement_timestamp()
             AND item.status NOT IN ('completed', 'cancelled') AS is_overdue,
           EXISTS (
             SELECT 1
             FROM marketing_ops.item_dependencies AS dependency
             JOIN marketing_ops.campaign_items AS predecessor
               ON predecessor.tenant_id = dependency.tenant_id
              AND predecessor.id = dependency.depends_on_item_id
             WHERE dependency.item_id = item.id
               AND predecessor.status <> 'completed'
           ) AS is_blocked
    FROM marketing_ops.campaign_items AS item
    JOIN marketing_ops.campaigns AS campaign
      ON campaign.tenant_id = item.tenant_id AND campaign.id = item.campaign_id
    WHERE campaign.status <> 'archived'
      AND marketing_ops_private.can_access_campaign_item(item.id)
      AND (requested_campaign_id IS NULL OR item.campaign_id = requested_campaign_id)
      AND (requested_kind IS NULL OR item.kind = requested_kind)
      AND (requested_channel IS NULL OR item.channel = requested_channel)
      AND (requested_assignee_id IS NULL OR item.assignee_user_id = requested_assignee_id)
      AND (requested_status IS NULL OR item.status = requested_status)
      AND (requested_priority IS NULL OR item.priority = requested_priority)
  )
  SELECT candidate.id, candidate.tenant_id, candidate.campaign_id, candidate.kind,
         candidate.title, candidate.description, candidate.content, candidate.status,
         candidate.priority, candidate.channel, candidate.assignee_user_id,
         candidate.starts_at, candidate.due_at, candidate.completed_at,
         candidate.cancelled_at, candidate.archived_at, candidate.metadata,
         candidate.version, candidate.created_by, candidate.updated_by,
         candidate.created_at, candidate.updated_at, candidate.campaign_name,
         candidate.effective_at, candidate.is_overdue, candidate.is_blocked
  FROM candidates AS candidate
  WHERE (
      (range_from IS NULL AND range_to IS NULL)
      OR (candidate.effective_at IS NOT NULL
          AND candidate.effective_at >= range_from
          AND candidate.effective_at < range_to)
    )
    AND (
      cursor_id IS NULL
      OR (cursor_effective_at IS NOT NULL AND (
        candidate.effective_at > cursor_effective_at
        OR (candidate.effective_at = cursor_effective_at AND candidate.priority_rank > cursor_priority_rank)
        OR (candidate.effective_at = cursor_effective_at AND candidate.priority_rank = cursor_priority_rank
            AND candidate.id > cursor_id)
      ))
      OR (cursor_effective_at IS NULL AND candidate.effective_at IS NULL AND (
        candidate.priority_rank > cursor_priority_rank
        OR (candidate.priority_rank = cursor_priority_rank AND candidate.id > cursor_id)
      ))
    )
  ORDER BY candidate.effective_at ASC NULLS LAST, candidate.priority_rank, candidate.id
  LIMIT least(greatest(result_limit, 1), 101)
$$;

CREATE FUNCTION marketing_ops_private.list_campaign_timeline(
  requested_campaign_id uuid,
  result_limit integer,
  cursor_occurred_at timestamptz,
  cursor_id uuid
)
RETURNS TABLE (
  id uuid,
  action text,
  occurred_at timestamptz,
  actor_display_name text,
  origin marketing_ops.origin_type,
  changes jsonb,
  correlation_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam, marketing_ops, marketing_ops_private
AS $$
  SELECT event.id,
         event.action,
         event.created_at,
         coalesce(nullif(btrim(principal.full_name), ''), principal.email, 'System'),
         event.origin,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
             'field', key,
             'kind', CASE
               WHEN coalesce(event.before_state, '{}'::jsonb) ? key
                AND coalesce(event.after_state, '{}'::jsonb) ? key THEN 'changed'
               WHEN coalesce(event.after_state, '{}'::jsonb) ? key THEN 'added'
               ELSE 'removed'
             END
           ) ORDER BY key)
           FROM (
             SELECT jsonb_object_keys(coalesce(event.before_state, '{}'::jsonb)
                    || coalesce(event.after_state, '{}'::jsonb)) AS key
           ) AS fields
         ), '[]'::jsonb),
         event.correlation_id
  FROM marketing_ops.audit_events AS event
  LEFT JOIN iam.principals AS principal ON principal.id = event.actor_user_id
  WHERE event.tenant_id = app_private.request_tenant_id()
    AND event.entity_id = requested_campaign_id
    AND event.origin IN ('rest', 'mcp', 'internal')
    AND marketing_ops_private.can_access_campaign(requested_campaign_id)
    AND (
      cursor_occurred_at IS NULL
      OR (event.created_at, event.id) < (cursor_occurred_at, cursor_id)
    )
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT least(greatest(result_limit, 1), 101)
$$;

REVOKE ALL ON FUNCTION marketing_ops_private.can_access_campaign(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.can_edit_campaign(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.can_manage_campaign(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.can_administer_campaign_participants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.can_access_campaign_item(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.can_edit_campaign_item(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.can_edit_content_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.list_campaign_participants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.is_campaign_participant_candidate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.list_campaign_participant_candidates(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.create_content_version(uuid, bigint, text, jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.list_production_schedule(timestamptz, timestamptz, uuid, marketing_ops.item_kind, marketing_ops.item_channel, uuid, marketing_ops.item_status, marketing_ops.item_priority, timestamptz, integer, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.list_campaign_timeline(uuid, integer, timestamptz, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION marketing_ops_private.can_access_campaign(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.can_edit_campaign(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.can_manage_campaign(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.can_administer_campaign_participants(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.can_access_campaign_item(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.can_edit_campaign_item(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.can_edit_content_asset(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.list_campaign_participants(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.is_campaign_participant_candidate(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.list_campaign_participant_candidates(uuid, text, integer) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.create_content_version(uuid, bigint, text, jsonb, text, boolean) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.list_production_schedule(timestamptz, timestamptz, uuid, marketing_ops.item_kind, marketing_ops.item_channel, uuid, marketing_ops.item_status, marketing_ops.item_priority, timestamptz, integer, uuid, integer) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.list_campaign_timeline(uuid, integer, timestamptz, uuid) TO nexus_app;
