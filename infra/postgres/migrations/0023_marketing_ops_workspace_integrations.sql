-- Installation apps and independent authorizations. Never store plaintext credentials.
CREATE TABLE marketing_ops_private.workspace_apps (
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id), family text NOT NULL CHECK(family IN('google','microsoft')),
 version bigint NOT NULL DEFAULT 1, file_id uuid NOT NULL, PRIMARY KEY(tenant_id,family)
);
CREATE TABLE marketing_ops.workspace_connections (
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id),service text NOT NULL CHECK(service IN('google_drive','google_gmail','google_calendar','google_sheets','google_search_console','microsoft_files','microsoft_mail','microsoft_calendar')),
 owner_id uuid NOT NULL REFERENCES iam.principals(id),version bigint NOT NULL DEFAULT 1,generation bigint NOT NULL DEFAULT 1,config_version text NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','pending_resource','connected','reconnect_required','disconnected','error')),
 identity jsonb,resources jsonb NOT NULL DEFAULT '[]',selected_resource jsonb,tokens_cipher text,token_revision bigint NOT NULL DEFAULT 1,
 safe_error text,last_sync_at timestamptz,PRIMARY KEY(tenant_id,service)
);
CREATE TABLE marketing_ops.workspace_oauth_states (
 state_hash text PRIMARY KEY CHECK(state_hash ~ '^[a-f0-9]{64}$'),tenant_id uuid NOT NULL REFERENCES iam.tenants(id),actor_id uuid NOT NULL REFERENCES iam.principals(id),
 session_hash text NOT NULL,service text NOT NULL,generation bigint NOT NULL,config_version text NOT NULL,verifier_cipher text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',consumed_at timestamptz,
 FOREIGN KEY(tenant_id,service) REFERENCES marketing_ops.workspace_connections(tenant_id,service)
);
CREATE TABLE marketing_ops.workspace_receipts (
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id),actor_id uuid NOT NULL REFERENCES iam.principals(id),operation text NOT NULL,idempotency_key text NOT NULL,
 request_hash text NOT NULL,status text NOT NULL CHECK(status IN('reserved','completed','uncertain','blocked','cancelled')),response jsonb,generation bigint,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,actor_id,operation,idempotency_key)
);
CREATE TABLE marketing_ops.workspace_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES iam.tenants(id),actor_id uuid NOT NULL REFERENCES iam.principals(id),
 service text NOT NULL,generation bigint NOT NULL,provider_id text NOT NULL,campaign_id uuid,content jsonb NOT NULL,sent_at timestamptz,send_status text NOT NULL DEFAULT 'drafted' CHECK(send_status IN('drafted','reserved','sent','uncertain','blocked')),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id)
);
CREATE TABLE marketing_ops.workspace_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES iam.tenants(id),campaign_id uuid NOT NULL,service text NOT NULL,
 kind text NOT NULL CHECK(kind IN('file','message')),resource_id text NOT NULL,name text NOT NULL,url text,active boolean NOT NULL DEFAULT true,generation bigint NOT NULL,identity_id text NOT NULL,
 version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES iam.principals(id),
 FOREIGN KEY(tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id)
);
CREATE TABLE marketing_ops.workspace_search_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES iam.tenants(id),service text NOT NULL DEFAULT 'google_search_console',
 resource_id text NOT NULL,generation bigint NOT NULL,period_from date NOT NULL,period_to date NOT NULL,payload jsonb NOT NULL,observed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,service) REFERENCES marketing_ops.workspace_connections(tenant_id,service)
);
CREATE INDEX workspace_search_recent ON marketing_ops.workspace_search_snapshots(tenant_id,resource_id,period_from,period_to,observed_at DESC);
DO $$ DECLARE tab text;schema_name text; BEGIN
 FOREACH tab IN ARRAY ARRAY['workspace_apps','workspace_connections','workspace_oauth_states','workspace_receipts','workspace_drafts','workspace_links','workspace_search_snapshots'] LOOP
 schema_name:=CASE WHEN tab='workspace_apps' THEN 'marketing_ops_private' ELSE 'marketing_ops' END;
 EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',schema_name,tab);
 EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',schema_name,tab);
 EXECUTE format('CREATE POLICY nexus_owner_all ON %I.%I TO nexus_owner USING(true) WITH CHECK(true)',schema_name,tab);
 EXECUTE format('CREATE POLICY workspace_read ON %I.%I FOR SELECT TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager''))',schema_name,tab);
 EXECUTE format('CREATE POLICY workspace_insert ON %I.%I FOR INSERT TO nexus_app WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (%s))',schema_name,tab,CASE WHEN tab='workspace_apps' THEN '''admin''' ELSE '''admin'',''manager''' END);
 EXECUTE format('CREATE POLICY workspace_update ON %I.%I FOR UPDATE TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (%s)) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (%s))',schema_name,tab,CASE WHEN tab='workspace_apps' THEN '''admin''' ELSE '''admin'',''manager''' END,CASE WHEN tab='workspace_apps' THEN '''admin''' ELSE '''admin'',''manager''' END);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I.%I TO nexus_app',schema_name,tab);
 END LOOP;
END $$;
-- A linked file or conversation inherits the campaign's visibility/editability.
ALTER POLICY workspace_read ON marketing_ops.workspace_links USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN('admin','manager') AND marketing_ops_private.can_access_campaign(campaign_id));
ALTER POLICY workspace_insert ON marketing_ops.workspace_links WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN('admin','manager') AND marketing_ops_private.can_edit_campaign(campaign_id));
ALTER POLICY workspace_update ON marketing_ops.workspace_links USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN('admin','manager') AND marketing_ops_private.can_edit_campaign(campaign_id)) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id));
CREATE OR REPLACE FUNCTION marketing_ops_private.ads_has_encrypted_references()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,marketing_ops_private,marketing_ops AS $$
 SELECT EXISTS(SELECT 1 FROM marketing_ops_private.ads_setup_publications)
 OR EXISTS(SELECT 1 FROM marketing_ops.ads_connections WHERE tokens_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.ads_oauth_states WHERE verifier_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.web_analytics_connections WHERE tokens_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.web_analytics_oauth_states WHERE verifier_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops_private.workspace_apps)
 OR EXISTS(SELECT 1 FROM marketing_ops.workspace_connections WHERE tokens_cipher IS NOT NULL)
 OR EXISTS(SELECT 1 FROM marketing_ops.workspace_oauth_states WHERE verifier_cipher IS NOT NULL)
$$;
