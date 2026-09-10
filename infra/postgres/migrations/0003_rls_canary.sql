CREATE FUNCTION app_private.request_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app_private.request_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION app_private.request_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.request_user_id() FROM PUBLIC;

CREATE TABLE app_private.tenant_canary (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  created_by uuid NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT tenant_canary_membership_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES iam.memberships (tenant_id, principal_id)
    ON DELETE RESTRICT,
  CONSTRAINT tenant_canary_label_check
    CHECK (char_length(label) BETWEEN 1 AND 200),
  CONSTRAINT tenant_canary_timestamp_order_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX tenant_canary_tenant_id_id_idx
  ON app_private.tenant_canary (tenant_id, id);

CREATE INDEX tenant_canary_membership_idx
  ON app_private.tenant_canary (tenant_id, created_by);

ALTER TABLE iam.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.principals FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.tenant_canary ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.tenant_canary FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select_current
  ON iam.tenants
  FOR SELECT
  TO nexus_app
  USING (id = (SELECT app_private.request_tenant_id()));

CREATE POLICY principals_select_current
  ON iam.principals
  FOR SELECT
  TO nexus_app
  USING (id = (SELECT app_private.request_user_id()));

CREATE POLICY memberships_select_current_tenant
  ON iam.memberships
  FOR SELECT
  TO nexus_app
  USING (tenant_id = (SELECT app_private.request_tenant_id()));

CREATE POLICY tenant_canary_select
  ON app_private.tenant_canary
  FOR SELECT
  TO nexus_app
  USING (tenant_id = (SELECT app_private.request_tenant_id()));

CREATE POLICY tenant_canary_insert
  ON app_private.tenant_canary
  FOR INSERT
  TO nexus_app
  WITH CHECK (
    tenant_id = (SELECT app_private.request_tenant_id())
    AND created_by = (SELECT app_private.request_user_id())
  );

CREATE POLICY tenant_canary_update
  ON app_private.tenant_canary
  FOR UPDATE
  TO nexus_app
  USING (tenant_id = (SELECT app_private.request_tenant_id()))
  WITH CHECK (
    tenant_id = (SELECT app_private.request_tenant_id())
    AND created_by = (SELECT app_private.request_user_id())
  );

CREATE POLICY tenant_canary_delete
  ON app_private.tenant_canary
  FOR DELETE
  TO nexus_app
  USING (tenant_id = (SELECT app_private.request_tenant_id()));

GRANT USAGE ON SCHEMA iam TO nexus_app;
GRANT USAGE ON SCHEMA app_private TO nexus_app;
GRANT EXECUTE ON FUNCTION app_private.request_tenant_id() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_private.request_user_id() TO nexus_app;
GRANT SELECT ON iam.tenants TO nexus_app;
GRANT SELECT ON iam.principals TO nexus_app;
GRANT SELECT ON iam.memberships TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.tenant_canary TO nexus_app;

