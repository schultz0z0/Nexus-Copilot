CREATE FUNCTION app_private.request_actor_role()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.actor_role', true), '')
$$;

CREATE FUNCTION app_private.request_actor_type()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'user')
$$;

CREATE FUNCTION marketing_ops_private.has_active_membership(requested_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM iam.memberships AS membership
     WHERE membership.tenant_id = requested_tenant_id
       AND membership.principal_id = app_private.request_user_id()
       AND membership.active
       AND membership.role = app_private.request_actor_role()
  )
$$;

REVOKE ALL ON FUNCTION app_private.request_actor_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.request_actor_type() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.has_active_membership(uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA marketing_ops TO nexus_app;
GRANT USAGE ON SCHEMA marketing_ops_private TO nexus_app;
GRANT EXECUTE ON FUNCTION app_private.request_actor_role() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_private.request_actor_type() TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.has_active_membership(uuid) TO nexus_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  marketing_ops.campaigns,
  marketing_ops.campaign_members,
  marketing_ops.campaign_materials,
  marketing_ops.campaign_items,
  marketing_ops.item_dependencies,
  marketing_ops.content_assets,
  marketing_ops.item_artifacts,
  marketing_ops.idempotency_records,
  marketing_ops.in_app_notifications
TO nexus_app;

GRANT SELECT, INSERT ON TABLE
  marketing_ops.content_versions,
  marketing_ops.approval_decisions,
  marketing_ops.audit_events,
  marketing_ops.delegation_uses
TO nexus_app;

GRANT SELECT, INSERT, UPDATE ON TABLE
  marketing_ops.approval_requests,
  marketing_ops.action_packages,
  marketing_ops.domain_events
TO nexus_app;

ALTER TABLE marketing_ops.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaign_members FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaign_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaign_materials FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaign_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.campaign_items FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.item_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.item_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.content_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.content_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.content_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.item_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.item_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.approval_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.approval_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.action_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.action_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.domain_events FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.delegation_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.delegation_uses FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.in_app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.in_app_notifications FORCE ROW LEVEL SECURITY;

CREATE FUNCTION marketing_ops_private.row_visible(row_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT row_tenant_id = app_private.request_tenant_id()
     AND marketing_ops_private.has_active_membership(row_tenant_id)
$$;

REVOKE ALL ON FUNCTION marketing_ops_private.row_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_ops_private.row_visible(uuid) TO nexus_app;

CREATE POLICY campaigns_tenant_all ON marketing_ops.campaigns
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY campaign_members_tenant_all ON marketing_ops.campaign_members
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY campaign_materials_tenant_all ON marketing_ops.campaign_materials
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY campaign_items_tenant_all ON marketing_ops.campaign_items
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY item_dependencies_tenant_all ON marketing_ops.item_dependencies
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY content_assets_tenant_all ON marketing_ops.content_assets
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY content_versions_tenant_select ON marketing_ops.content_versions
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY content_versions_tenant_insert ON marketing_ops.content_versions
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY item_artifacts_tenant_all ON marketing_ops.item_artifacts
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY approval_requests_tenant_select ON marketing_ops.approval_requests
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY approval_requests_tenant_insert ON marketing_ops.approval_requests
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY approval_requests_tenant_update ON marketing_ops.approval_requests
  FOR UPDATE TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY approval_decisions_tenant_select ON marketing_ops.approval_decisions
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY approval_decisions_tenant_insert ON marketing_ops.approval_decisions
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY action_packages_tenant_select ON marketing_ops.action_packages
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY action_packages_tenant_insert ON marketing_ops.action_packages
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY action_packages_tenant_update ON marketing_ops.action_packages
  FOR UPDATE TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY audit_events_tenant_select ON marketing_ops.audit_events
  FOR SELECT TO nexus_app
  USING (
    marketing_ops_private.row_visible(tenant_id)
    AND app_private.request_actor_role() IN ('manager', 'admin')
  );
CREATE POLICY audit_events_tenant_insert ON marketing_ops.audit_events
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY domain_events_tenant_select ON marketing_ops.domain_events
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY domain_events_tenant_insert ON marketing_ops.domain_events
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY domain_events_tenant_update ON marketing_ops.domain_events
  FOR UPDATE TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE POLICY idempotency_records_tenant_all ON marketing_ops.idempotency_records
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id) AND actor_id = app_private.request_user_id())
  WITH CHECK (marketing_ops_private.row_visible(tenant_id) AND actor_id = app_private.request_user_id());

CREATE POLICY delegation_uses_tenant_select ON marketing_ops.delegation_uses
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id) AND actor_id = app_private.request_user_id());
CREATE POLICY delegation_uses_tenant_insert ON marketing_ops.delegation_uses
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id) AND actor_id = app_private.request_user_id());

CREATE POLICY in_app_notifications_tenant_select ON marketing_ops.in_app_notifications
  FOR SELECT TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id) AND user_id = app_private.request_user_id());
CREATE POLICY in_app_notifications_tenant_insert ON marketing_ops.in_app_notifications
  FOR INSERT TO nexus_app
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));
CREATE POLICY in_app_notifications_tenant_update ON marketing_ops.in_app_notifications
  FOR UPDATE TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id) AND user_id = app_private.request_user_id())
  WITH CHECK (marketing_ops_private.row_visible(tenant_id) AND user_id = app_private.request_user_id());
CREATE POLICY in_app_notifications_tenant_delete ON marketing_ops.in_app_notifications
  FOR DELETE TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id) AND user_id = app_private.request_user_id());

