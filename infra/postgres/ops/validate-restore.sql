\set ON_ERROR_STOP on

-- Validate critical relations exist
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'iam' AND tablename = 'tenants'), 'iam.tenants missing';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'iam' AND tablename = 'principals'), 'iam.principals missing';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'iam' AND tablename = 'memberships'), 'iam.memberships missing';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'app_private' AND tablename = 'tenant_canary'), 'app_private.tenant_canary missing';
  ASSERT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'infra' AND tablename = 'schema_migrations'), 'infra.schema_migrations missing';
END $$;

-- Validate application role is not owner and not superuser
DO $$
BEGIN
  ASSERT NOT pg_has_role('nexus_app', 'nexus_owner', 'MEMBER'), 'nexus_app must not be nexus_owner member';
  ASSERT NOT (SELECT rolsuper FROM pg_roles WHERE rolname = 'nexus_app'), 'nexus_app must not be superuser';
END $$;

-- Validate sentinel data count is greater than 0
DO $$
DECLARE
  tenant_count int;
  canary_count int;
BEGIN
  SELECT count(*) INTO tenant_count FROM iam.tenants;
  ASSERT tenant_count >= 2, 'expected at least 2 tenants in restored database';

  SELECT count(*) INTO canary_count FROM app_private.tenant_canary;
  ASSERT canary_count >= 1, 'expected at least 1 canary record in restored database';
END $$;
