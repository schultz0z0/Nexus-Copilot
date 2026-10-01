-- Public references only: credentials remain encrypted in installation storage.
CREATE TABLE marketing_ops_private.ads_setup_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id)
);
CREATE TABLE marketing_ops_private.ads_setup_publications (
  provider text PRIMARY KEY CHECK(provider IN ('meta','google','linkedin')),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  version bigint NOT NULL CHECK(version > 1),
  file_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE marketing_ops_private.ads_setup_receipts (
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  actor_id uuid NOT NULL REFERENCES iam.principals(id),
  provider text NOT NULL CHECK(provider IN ('meta','google','linkedin')),
  idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,actor_id,provider,idempotency_key)
);
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['ads_setup_binding','ads_setup_publications','ads_setup_receipts'] LOOP
    EXECUTE format('ALTER TABLE marketing_ops_private.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE marketing_ops_private.%I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY nexus_owner_all ON marketing_ops_private.%I TO nexus_owner USING(true) WITH CHECK(true)',tab);
    EXECUTE format('CREATE POLICY setup_read ON marketing_ops_private.%I FOR SELECT TO nexus_app USING(%s)',tab,CASE WHEN tab='ads_setup_binding' THEN 'true' ELSE 'marketing_ops_private.row_visible(tenant_id)' END);
    EXECUTE format('CREATE POLICY setup_insert ON marketing_ops_private.%I FOR INSERT TO nexus_app WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role()=%L)',tab,'admin');
    EXECUTE format('CREATE POLICY setup_update ON marketing_ops_private.%I FOR UPDATE TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role()=%L) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role()=%L)',tab,'admin','admin');
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON marketing_ops_private.ads_setup_binding,marketing_ops_private.ads_setup_publications,marketing_ops_private.ads_setup_receipts TO nexus_app;
-- Exposes only whether an installation key may still protect existing data.
-- Never exposes tenant identities, ciphertext, or publication file IDs at boot.
CREATE FUNCTION marketing_ops_private.ads_has_encrypted_references()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,marketing_ops_private,marketing_ops AS $$
  SELECT EXISTS(SELECT 1 FROM marketing_ops_private.ads_setup_publications)
    OR EXISTS(SELECT 1 FROM marketing_ops.ads_connections WHERE tokens_cipher IS NOT NULL)
    OR EXISTS(SELECT 1 FROM marketing_ops.ads_oauth_states WHERE verifier_cipher IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION marketing_ops_private.ads_has_encrypted_references() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_ops_private.ads_has_encrypted_references() TO nexus_app;
