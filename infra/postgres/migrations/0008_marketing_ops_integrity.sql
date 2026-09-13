CREATE FUNCTION marketing_ops_private.reject_append_only_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER content_versions_append_only
BEFORE UPDATE OR DELETE ON marketing_ops.content_versions
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.reject_append_only_change();

CREATE TRIGGER approval_decisions_append_only
BEFORE UPDATE OR DELETE ON marketing_ops.approval_decisions
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.reject_append_only_change();

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON marketing_ops.audit_events
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.reject_append_only_change();

CREATE FUNCTION marketing_ops_private.enforce_action_package_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, marketing_ops
AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.action_type IS DISTINCT FROM OLD.action_type
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.audience_snapshot IS DISTINCT FROM OLD.audience_snapshot
     OR NEW.configuration IS DISTINCT FROM OLD.configuration
     OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
     OR NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN
    RAISE EXCEPTION 'action package payload is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.status = 'pending_approval'
    AND NEW.status IN ('authorized', 'invalidated', 'expired')
  ) THEN
    RAISE EXCEPTION 'invalid action package transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'authorized' AND (
    NEW.authorized_by_request_id IS NULL OR NEW.authorized_at IS NULL
    OR NEW.invalidated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'authorized package requires its approved request and decision'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('invalidated', 'expired') AND NEW.invalidated_at IS NULL THEN
    RAISE EXCEPTION 'invalidated or expired package requires invalidation time'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER action_packages_payload_immutable
BEFORE UPDATE ON marketing_ops.action_packages
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.enforce_action_package_integrity();

CREATE FUNCTION marketing_ops_private.enforce_campaign_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('planned', 'archived'))
    OR (OLD.status = 'planned' AND NEW.status IN ('draft', 'active', 'archived'))
    OR (OLD.status = 'active' AND NEW.status IN ('planned', 'completed', 'archived'))
    OR (OLD.status = 'completed' AND NEW.status IN ('active', 'archived'))
  ) THEN
    RAISE EXCEPTION 'invalid campaign transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER campaigns_state_machine
BEFORE UPDATE ON marketing_ops.campaigns
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.enforce_campaign_transition();

CREATE FUNCTION marketing_ops_private.enforce_item_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('ready', 'cancelled'))
    OR (OLD.status = 'ready' AND NEW.status IN ('draft', 'in_review', 'cancelled'))
    OR (OLD.status = 'in_review' AND NEW.status IN ('ready', 'completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid item transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER campaign_items_state_machine
BEFORE UPDATE ON marketing_ops.campaign_items
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.enforce_item_transition();

CREATE FUNCTION marketing_ops_private.enforce_approval_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, marketing_ops
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN (
      'approved', 'rejected', 'changes_requested', 'cancelled', 'expired'
    ) THEN
      RAISE EXCEPTION 'invalid approval transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM marketing_ops.approval_decisions AS decision
       WHERE decision.tenant_id = NEW.tenant_id
         AND decision.request_id = NEW.id
         AND decision.decision = NEW.status
    ) THEN
      RAISE EXCEPTION 'approval request transition requires its matching decision'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER approval_requests_state_machine
BEFORE UPDATE ON marketing_ops.approval_requests
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.enforce_approval_transition();

CREATE FUNCTION marketing_ops_private.enforce_dependency_graph()
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
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'dependency cycle is not allowed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER item_dependencies_enforce_graph
BEFORE INSERT OR UPDATE ON marketing_ops.item_dependencies
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.enforce_dependency_graph();

CREATE TRIGGER campaigns_touch_updated_at
BEFORE UPDATE ON marketing_ops.campaigns
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();
CREATE TRIGGER campaign_items_touch_updated_at
BEFORE UPDATE ON marketing_ops.campaign_items
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();
CREATE TRIGGER content_assets_touch_updated_at
BEFORE UPDATE ON marketing_ops.content_assets
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();
CREATE TRIGGER approval_requests_touch_updated_at
BEFORE UPDATE ON marketing_ops.approval_requests
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();
CREATE TRIGGER action_packages_touch_updated_at
BEFORE UPDATE ON marketing_ops.action_packages
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();
CREATE TRIGGER idempotency_records_touch_updated_at
BEFORE UPDATE ON marketing_ops.idempotency_records
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();

CREATE UNIQUE INDEX campaign_members_one_primary_owner_idx
  ON marketing_ops.campaign_members (campaign_id)
  WHERE member_role = 'owner' AND is_primary;

REVOKE ALL ON FUNCTION marketing_ops_private.reject_append_only_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.enforce_action_package_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.enforce_campaign_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.enforce_item_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.enforce_approval_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.enforce_dependency_graph() FROM PUBLIC;

