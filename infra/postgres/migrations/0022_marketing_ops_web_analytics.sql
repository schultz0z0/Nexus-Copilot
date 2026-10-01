-- Analytics describes anonymous visits, never people, leads or sales.
CREATE TABLE marketing_ops.web_analytics_connections (
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id), provider text NOT NULL CHECK(provider IN ('ga4','clarity')),
 owner_id uuid NOT NULL REFERENCES iam.principals(id), status text NOT NULL DEFAULT 'prepared',
 version bigint NOT NULL DEFAULT 1, generation bigint NOT NULL DEFAULT 1, config_version text,
 tokens_cipher text, resources jsonb NOT NULL DEFAULT '[]', selected_resource_id text,
 last_sync_at timestamptz, safe_error text, next_sync_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,provider), CHECK(status IN ('prepared','pending_resource','connected','partial','reconnect_required','disconnected','error'))
);
CREATE TABLE marketing_ops.web_analytics_oauth_states (
 state_hash text PRIMARY KEY CHECK(state_hash ~ '^[0-9a-f]{64}$'), tenant_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES iam.principals(id), session_hash text NOT NULL,
 generation bigint NOT NULL, config_version text NOT NULL, verifier_cipher text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', consumed_at timestamptz,
 FOREIGN KEY(tenant_id) REFERENCES iam.tenants(id)
);
CREATE TABLE marketing_ops.web_analytics_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES iam.tenants(id), campaign_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('ga4','clarity')), resource_id text NOT NULL,
 utm_campaign text NOT NULL CHECK(char_length(utm_campaign) BETWEEN 1 AND 200), enabled boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES iam.principals(id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id)
);
CREATE UNIQUE INDEX web_analytics_one_segment ON marketing_ops.web_analytics_links(tenant_id,provider,resource_id,utm_campaign) WHERE enabled;
CREATE TABLE marketing_ops.web_analytics_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, provider text NOT NULL,
 resource_id text NOT NULL, generation bigint NOT NULL, period_from date NOT NULL, period_to date NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
 FOREIGN KEY(tenant_id,provider) REFERENCES marketing_ops.web_analytics_connections(tenant_id,provider)
);
CREATE INDEX web_analytics_recent_snapshots ON marketing_ops.web_analytics_snapshots(tenant_id,provider,resource_id,observed_at DESC);
CREATE TABLE marketing_ops.web_analytics_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, provider text NOT NULL,
 actor_id uuid NOT NULL REFERENCES iam.principals(id), idempotency_key text NOT NULL, request_hash text NOT NULL,
 generation bigint NOT NULL, attempt uuid NOT NULL DEFAULT gen_random_uuid(), lease_until timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','partial','error','cancelled')),
 receipt jsonb, safe_error text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,provider,actor_id,idempotency_key),
 FOREIGN KEY(tenant_id,provider) REFERENCES marketing_ops.web_analytics_connections(tenant_id,provider)
);
CREATE TABLE marketing_ops.web_analytics_quota (
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id), day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 used integer NOT NULL DEFAULT 0 CHECK(used BETWEEN 0 AND 10), PRIMARY KEY(tenant_id,day)
);
-- Reusable commands have bounded payload hashes and never retain credentials.
CREATE TABLE marketing_ops.web_analytics_receipts (
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id), actor_id uuid NOT NULL REFERENCES iam.principals(id),
 operation text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,operation,idempotency_key)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['web_analytics_connections','web_analytics_oauth_states','web_analytics_links','web_analytics_snapshots','web_analytics_jobs','web_analytics_quota','web_analytics_receipts'] LOOP
 EXECUTE format('ALTER TABLE marketing_ops.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE marketing_ops.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY nexus_owner_all ON marketing_ops.%I TO nexus_owner USING(true) WITH CHECK(true)',tab);
 IF tab='web_analytics_links' THEN
 EXECUTE format('CREATE POLICY analytics_read ON marketing_ops.%I FOR SELECT TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_access_campaign(campaign_id))',tab);
 EXECUTE format('CREATE POLICY analytics_insert ON marketing_ops.%I FOR INSERT TO nexus_app WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager'') AND marketing_ops_private.can_edit_campaign(campaign_id))',tab);
 EXECUTE format('CREATE POLICY analytics_update ON marketing_ops.%I FOR UPDATE TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager'') AND marketing_ops_private.can_edit_campaign(campaign_id)) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id))',tab);
 ELSE
 -- Property-wide analytics is operational company data, visible to managers.
 EXECUTE format('CREATE POLICY analytics_read ON marketing_ops.%I FOR SELECT TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager''))',tab);
 EXECUTE format('CREATE POLICY analytics_insert ON marketing_ops.%I FOR INSERT TO nexus_app WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager''))',tab);
 EXECUTE format('CREATE POLICY analytics_update ON marketing_ops.%I FOR UPDATE TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager'')) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager''))',tab);
 END IF;
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON marketing_ops.%I TO nexus_app',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION marketing_ops_private.ads_has_encrypted_references()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,marketing_ops_private,marketing_ops AS $$
 SELECT EXISTS(SELECT 1 FROM marketing_ops_private.ads_setup_publications)
 OR EXISTS(SELECT 1 FROM marketing_ops.ads_connections WHERE tokens_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.ads_oauth_states WHERE verifier_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.web_analytics_connections WHERE tokens_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.web_analytics_oauth_states WHERE verifier_cipher IS NOT NULL)
$$;
CREATE FUNCTION marketing_ops_private.web_analytics_due(maximum integer)
RETURNS TABLE(tenant_id uuid,owner_id uuid,provider text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,marketing_ops,iam AS $$
 SELECT c.tenant_id,c.owner_id,c.provider FROM marketing_ops.web_analytics_connections c
 JOIN iam.memberships m ON m.tenant_id=c.tenant_id AND m.principal_id=c.owner_id AND m.active AND m.role IN ('admin','manager')
 JOIN iam.principals p ON p.id=c.owner_id AND p.disabled_at IS NULL
 WHERE c.status IN ('connected','partial') AND c.tokens_cipher IS NOT NULL AND c.selected_resource_id IS NOT NULL AND c.next_sync_at<=now()
 ORDER BY c.next_sync_at LIMIT greatest(0,least(maximum,20))
$$;
REVOKE ALL ON FUNCTION marketing_ops_private.web_analytics_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_ops_private.web_analytics_due(integer) TO nexus_app;
