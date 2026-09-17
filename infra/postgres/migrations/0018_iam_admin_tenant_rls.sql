-- The initial IAM RLS rollout did not grant nexus_app a policy for principals
-- or memberships writes.  The App API administrative routes now establish the
-- authenticated actor and tenant as transaction-local context before using
-- these policies.

CREATE POLICY principals_select_current_tenant
  ON iam.principals
  FOR SELECT
  TO nexus_app
  USING (
    EXISTS (
      SELECT 1
      FROM iam.memberships AS membership
      WHERE membership.principal_id = iam.principals.id
        AND membership.tenant_id = app_private.request_tenant_id()
    )
  );

CREATE POLICY principals_insert_current_tenant
  ON iam.principals
  FOR INSERT
  TO nexus_app
  WITH CHECK (app_private.request_tenant_id() IS NOT NULL);

CREATE POLICY principals_update_current_tenant
  ON iam.principals
  FOR UPDATE
  TO nexus_app
  USING (
    EXISTS (
      SELECT 1
      FROM iam.memberships AS membership
      WHERE membership.principal_id = iam.principals.id
        AND membership.tenant_id = app_private.request_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM iam.memberships AS membership
      WHERE membership.principal_id = iam.principals.id
        AND membership.tenant_id = app_private.request_tenant_id()
    )
  );

CREATE POLICY principals_delete_current_tenant
  ON iam.principals
  FOR DELETE
  TO nexus_app
  USING (
    EXISTS (
      SELECT 1
      FROM iam.memberships AS membership
      WHERE membership.principal_id = iam.principals.id
        AND membership.tenant_id = app_private.request_tenant_id()
    )
  );

CREATE POLICY memberships_insert_current_tenant
  ON iam.memberships
  FOR INSERT
  TO nexus_app
  WITH CHECK (tenant_id = app_private.request_tenant_id());

CREATE POLICY memberships_update_current_tenant
  ON iam.memberships
  FOR UPDATE
  TO nexus_app
  USING (tenant_id = app_private.request_tenant_id())
  WITH CHECK (tenant_id = app_private.request_tenant_id());

CREATE POLICY memberships_delete_current_tenant
  ON iam.memberships
  FOR DELETE
  TO nexus_app
  USING (tenant_id = app_private.request_tenant_id());
