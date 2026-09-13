CREATE FUNCTION marketing_ops_private.assert_campaign_item_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, iam, marketing_ops
AS $$
BEGIN
  IF NEW.assignee_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM iam.memberships AS membership
    JOIN iam.principals AS principal ON principal.id = membership.principal_id
    WHERE membership.tenant_id = NEW.tenant_id
      AND membership.principal_id = NEW.assignee_user_id
      AND membership.active
      AND principal.disabled_at IS NULL
      AND (
        membership.role IN ('manager', 'admin')
        OR EXISTS (
          SELECT 1 FROM marketing_ops.campaign_members AS member
          WHERE member.tenant_id = NEW.tenant_id
            AND member.campaign_id = NEW.campaign_id
            AND member.user_id = NEW.assignee_user_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'campaign item assignee is not authorized'
      USING ERRCODE = '23514', CONSTRAINT = 'campaign_items_assignee_authorized';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER campaign_items_assert_assignee
BEFORE INSERT OR UPDATE OF tenant_id, campaign_id, assignee_user_id
ON marketing_ops.campaign_items
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.assert_campaign_item_assignee();

CREATE OR REPLACE FUNCTION marketing_ops_private.enforce_dependency_graph()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, marketing_ops
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM marketing_ops.campaign_items AS parent
     WHERE parent.id = NEW.depends_on_item_id
       AND parent.tenant_id = NEW.tenant_id
       AND parent.campaign_id = NEW.campaign_id
  ) OR NOT EXISTS (
    SELECT 1 FROM marketing_ops.campaign_items AS child
     WHERE child.id = NEW.item_id
       AND child.tenant_id = NEW.tenant_id
       AND child.campaign_id = NEW.campaign_id
  ) THEN
    RAISE EXCEPTION 'dependency items must belong to the same campaign'
      USING ERRCODE = '23514', CONSTRAINT = 'item_dependencies_same_campaign';
  END IF;

  IF EXISTS (
    WITH RECURSIVE descendants(item_id) AS (
      SELECT dependency.depends_on_item_id
        FROM marketing_ops.item_dependencies AS dependency
       WHERE dependency.tenant_id = NEW.tenant_id
         AND dependency.item_id = NEW.depends_on_item_id
      UNION
      SELECT dependency.depends_on_item_id
        FROM marketing_ops.item_dependencies AS dependency
        JOIN descendants ON descendants.item_id = dependency.item_id
       WHERE dependency.tenant_id = NEW.tenant_id
    )
    SELECT 1 FROM descendants WHERE item_id = NEW.item_id
  ) THEN
    RAISE EXCEPTION 'dependency cycle is not allowed'
      USING ERRCODE = '23514', CONSTRAINT = 'item_dependencies_acyclic';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION marketing_ops_private.assert_campaign_item_assignee() FROM PUBLIC;

DROP FUNCTION marketing_ops_private.list_production_schedule(
  timestamptz, timestamptz, uuid, marketing_ops.item_kind,
  marketing_ops.item_channel, uuid, marketing_ops.item_status,
  marketing_ops.item_priority, timestamptz, integer, uuid, integer
);

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
  title text, description text, content jsonb, status marketing_ops.item_status,
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
             WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1
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
        OR (candidate.effective_at = cursor_effective_at AND candidate.priority_rank < cursor_priority_rank)
        OR (candidate.effective_at = cursor_effective_at AND candidate.priority_rank = cursor_priority_rank
            AND candidate.id > cursor_id)
      ))
      OR (cursor_effective_at IS NULL AND candidate.effective_at IS NULL AND (
        candidate.priority_rank < cursor_priority_rank
        OR (candidate.priority_rank = cursor_priority_rank AND candidate.id > cursor_id)
      ))
    )
  ORDER BY candidate.effective_at ASC NULLS LAST, candidate.priority_rank DESC, candidate.id
  LIMIT least(greatest(result_limit, 1), 101)
$$;

REVOKE ALL ON FUNCTION marketing_ops_private.list_production_schedule(
  timestamptz, timestamptz, uuid, marketing_ops.item_kind,
  marketing_ops.item_channel, uuid, marketing_ops.item_status,
  marketing_ops.item_priority, timestamptz, integer, uuid, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_ops_private.list_production_schedule(
  timestamptz, timestamptz, uuid, marketing_ops.item_kind,
  marketing_ops.item_channel, uuid, marketing_ops.item_status,
  marketing_ops.item_priority, timestamptz, integer, uuid, integer
) TO nexus_app;
