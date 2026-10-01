-- Ads connections belong to an installation/tenant. Ciphertext is never a DTO.
CREATE TABLE marketing_ops.ads_connections (
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  provider text NOT NULL CHECK (provider IN ('meta','google','linkedin')),
  owner_id uuid NOT NULL REFERENCES iam.principals(id),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('prepared','pending_account','connected','partial','reconnect_required','disconnected','error')),
  tokens_cipher text,
  accounts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(accounts)='array'),
  selected_account_id text,
  capabilities jsonb NOT NULL DEFAULT '{"metrics":false,"nativeLeads":false}' CHECK (jsonb_typeof(capabilities)='object'),
  safe_error text,
  last_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,provider)
);
CREATE TABLE marketing_ops.ads_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  actor_id uuid NOT NULL REFERENCES iam.principals(id),
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  generation bigint NOT NULL,
  verifier_cipher text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  consumed_at timestamptz,
  FOREIGN KEY (tenant_id,provider) REFERENCES marketing_ops.ads_connections(tenant_id,provider)
);
CREATE INDEX ads_oauth_expiry ON marketing_ops.ads_oauth_states(expires_at);
CREATE TABLE marketing_ops.ads_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  provider text NOT NULL,
  source_id uuid NOT NULL,
  external_account_id text NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 200),
  external_campaign_id text NOT NULL CHECK (char_length(external_campaign_id) BETWEEN 1 AND 200),
  destination text NOT NULL CHECK (destination IN ('native_form','landing_page','whatsapp')),
  enabled boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES iam.principals(id),
  last_sync_at timestamptz,
  safe_error text,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,campaign_id,id),
  FOREIGN KEY (tenant_id,provider) REFERENCES marketing_ops.ads_connections(tenant_id,provider),
  FOREIGN KEY (tenant_id,campaign_id,source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id)
);
CREATE UNIQUE INDEX ads_link_one_campaign ON marketing_ops.ads_links(tenant_id,provider,external_account_id,external_campaign_id) WHERE enabled;
CREATE UNIQUE INDEX ads_link_one_source ON marketing_ops.ads_links(tenant_id,source_id) WHERE enabled;
CREATE TABLE marketing_ops.ads_daily_metrics (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  link_id uuid NOT NULL,
  day date NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  time_zone text NOT NULL,
  spend numeric(18,2) NOT NULL CHECK (spend >= 0),
  impressions bigint NOT NULL CHECK (impressions >= 0),
  clicks bigint NOT NULL CHECK (clicks >= 0),
  conversions numeric(18,6) CHECK (conversions >= 0),
  active boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id,day),
  FOREIGN KEY (tenant_id,campaign_id,link_id) REFERENCES marketing_ops.ads_links(tenant_id,campaign_id,id)
);
CREATE TABLE marketing_ops.ads_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  link_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES iam.principals(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  generation bigint NOT NULL,
  attempt uuid NOT NULL,
  lease_until timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','needs_review','error','cancelled')),
  receipt jsonb,
  safe_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id,actor_id,link_id,idempotency_key),
  FOREIGN KEY (tenant_id,campaign_id,link_id) REFERENCES marketing_ops.ads_links(tenant_id,campaign_id,id)
);
ALTER TABLE marketing_ops.result_reports ADD COLUMN ads_link_id uuid REFERENCES marketing_ops.ads_links(id);
ALTER TABLE marketing_ops.result_reports ADD COLUMN ads_active boolean NOT NULL DEFAULT true;
ALTER TABLE marketing_ops.result_reports ADD CONSTRAINT result_report_manual_active CHECK (ads_link_id IS NOT NULL OR ads_active);
CREATE UNIQUE INDEX ads_report_day ON marketing_ops.result_reports(ads_link_id,period_from) WHERE ads_link_id IS NOT NULL;
-- Retired provider measurements remain in history but have no current rollup
-- authority and must not block a human report for the same period.
CREATE OR REPLACE FUNCTION marketing_ops_private.validate_result_report() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,marketing_ops AS $$
BEGIN
  PERFORM 1 FROM marketing_ops.lead_sources WHERE id=NEW.source_id AND tenant_id=NEW.tenant_id AND campaign_id=NEW.campaign_id FOR UPDATE;
  IF NEW.action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marketing_ops.campaign_items WHERE id=NEW.action_id AND tenant_id=NEW.tenant_id AND campaign_id=NEW.campaign_id) THEN
    RAISE EXCEPTION 'Report action must belong to its campaign' USING ERRCODE='23514';
  END IF;
  IF NEW.ads_active AND EXISTS(SELECT 1 FROM marketing_ops.result_reports report WHERE report.ads_active AND report.tenant_id=NEW.tenant_id AND report.source_id=NEW.source_id AND (report.action_id IS NOT DISTINCT FROM NEW.action_id OR report.action_id IS NULL OR NEW.action_id IS NULL) AND report.id<>NEW.id AND daterange(report.period_from,report.period_to,'[]')&&daterange(NEW.period_from,NEW.period_to,'[]')) THEN
    RAISE EXCEPTION 'Report periods overlap' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $$;
-- A human cannot silently alter a snapshot owned by a provider. The sync path
-- explicitly sets this local capability only after owner/generation checks.
CREATE FUNCTION marketing_ops_private.protect_ads_report() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (NEW.ads_link_id IS NOT NULL OR (TG_OP='UPDATE' AND OLD.ads_link_id IS NOT NULL)) AND current_setting('app.ads_sync',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Provider results can only be revised by synchronization' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_ads_report BEFORE INSERT OR UPDATE ON marketing_ops.result_reports FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.protect_ads_report();

DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['ads_connections','ads_oauth_states','ads_links','ads_daily_metrics','ads_sync_jobs'] LOOP
    EXECUTE format('ALTER TABLE marketing_ops.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE marketing_ops.%I FORCE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY nexus_owner_all ON marketing_ops.%I TO nexus_owner USING(true) WITH CHECK(true)',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['ads_connections','ads_oauth_states'] LOOP
    EXECUTE format('CREATE POLICY ads_read ON marketing_ops.%I FOR SELECT TO nexus_app USING(marketing_ops_private.row_visible(tenant_id))',tab);
    EXECUTE format('CREATE POLICY ads_insert ON marketing_ops.%I FOR INSERT TO nexus_app WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager''))',tab);
    EXECUTE format('CREATE POLICY ads_update ON marketing_ops.%I FOR UPDATE TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager'')) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND app_private.request_actor_role() IN (''admin'',''manager''))',tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['ads_links','ads_daily_metrics','ads_sync_jobs'] LOOP
    EXECUTE format('CREATE POLICY ads_read ON marketing_ops.%I FOR SELECT TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_access_campaign(campaign_id))',tab);
    EXECUTE format('CREATE POLICY ads_insert ON marketing_ops.%I FOR INSERT TO nexus_app WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id))',tab);
    EXECUTE format('CREATE POLICY ads_update ON marketing_ops.%I FOR UPDATE TO nexus_app USING(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id)) WITH CHECK(marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id))',tab);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON marketing_ops.ads_connections,marketing_ops.ads_oauth_states,marketing_ops.ads_links,marketing_ops.ads_daily_metrics,marketing_ops.ads_sync_jobs TO nexus_app;
-- Worker discovers only canonical owners; resolve_actor and campaign RLS are
-- rechecked before each fetch and again before accepting its results.
CREATE FUNCTION marketing_ops_private.ads_due_links(maximum integer)
RETURNS TABLE(link_id uuid,campaign_id uuid,tenant_id uuid,owner_id uuid,time_zone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,marketing_ops,iam AS $$
  SELECT link.id,link.campaign_id,link.tenant_id,connection.owner_id,
    (SELECT account->>'timeZone' FROM jsonb_array_elements(connection.accounts) account WHERE account->>'id'=connection.selected_account_id LIMIT 1)
  FROM marketing_ops.ads_links link
  JOIN marketing_ops.ads_connections connection ON connection.tenant_id=link.tenant_id AND connection.provider=link.provider
  JOIN iam.memberships membership ON membership.tenant_id=connection.tenant_id AND membership.principal_id=connection.owner_id AND membership.active AND membership.role IN ('admin','manager')
  JOIN iam.principals principal ON principal.id=connection.owner_id AND principal.disabled_at IS NULL
  JOIN marketing_ops.campaigns campaign ON campaign.id=link.campaign_id AND campaign.tenant_id=link.tenant_id
  JOIN marketing_ops.lead_sources source ON source.id=link.source_id AND source.campaign_id=link.campaign_id AND source.tenant_id=link.tenant_id
  WHERE link.enabled AND link.next_sync_at<=now() AND connection.status IN ('connected','partial') AND connection.tokens_cipher IS NOT NULL
    AND connection.selected_account_id=link.external_account_id AND campaign.status IN ('planned','active')
    AND source.enabled AND source.classification='lead' AND source.channel=link.provider||'_ads'
    AND (source.external_account_id IS NULL OR source.external_account_id=link.external_account_id)
    AND (source.external_campaign_id IS NULL OR source.external_campaign_id=link.external_campaign_id)
  ORDER BY link.next_sync_at,link.id LIMIT greatest(0,least(maximum,20))
$$;
REVOKE ALL ON FUNCTION marketing_ops_private.ads_due_links(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_ops_private.ads_due_links(integer) TO nexus_app;
