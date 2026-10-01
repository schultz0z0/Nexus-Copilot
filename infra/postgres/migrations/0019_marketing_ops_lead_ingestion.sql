-- Campaign acquisition and reporting. Contact origins are immutable; cold
-- prospects and measured acquisition remain distinct. No CRM stages are added.
CREATE TABLE marketing_ops.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  channel text NOT NULL CHECK (channel IN ('meta_ads','google_ads','linkedin_ads','email','whatsapp','organic','google_maps','other')),
  kind text NOT NULL CHECK (kind IN ('landing_page','whatsapp','manual')),
  classification text NOT NULL CHECK (classification IN ('cold','lead')),
  action_id uuid,
  external_account_id text CHECK (char_length(external_account_id) BETWEEN 1 AND 200),
  external_campaign_id text CHECK (char_length(external_campaign_id) BETWEEN 1 AND 200),
  allowed_origins text[] NOT NULL DEFAULT '{}',
  whatsapp_phone text CHECK (whatsapp_phone ~ '^[1-9][0-9]{7,14}$'),
  enabled boolean NOT NULL DEFAULT true,
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{32}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES iam.principals(id),
  updated_by uuid NOT NULL REFERENCES iam.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,campaign_id,id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id),
  FOREIGN KEY (tenant_id,action_id) REFERENCES marketing_ops.campaign_items(tenant_id,id),
  CHECK (kind <> 'landing_page' OR cardinality(allowed_origins) > 0),
  CHECK (cardinality(allowed_origins) <= 20),
  CHECK (kind <> 'whatsapp' OR whatsapp_phone IS NOT NULL)
);

CREATE TABLE marketing_ops.lead_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  origin_campaign_id uuid NOT NULL,
  origin_source_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  email text CHECK (char_length(email) <= 254 AND email = lower(email)),
  phone text CHECK (phone ~ '^[1-9][0-9]{7,14}$'),
  company text CHECK (char_length(company) <= 200),
  first_occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,origin_campaign_id,origin_source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX lead_contacts_email ON marketing_ops.lead_contacts(tenant_id,email) WHERE email IS NOT NULL;
CREATE INDEX lead_contacts_phone ON marketing_ops.lead_contacts(tenant_id,phone) WHERE phone IS NOT NULL;

CREATE TABLE marketing_ops.campaign_leads (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  first_source_id uuid NOT NULL,
  captured_source_id uuid,
  classification text NOT NULL CHECK (classification IN ('cold','lead')),
  first_occurred_at timestamptz NOT NULL,
  captured_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,contact_id),
  UNIQUE (tenant_id,campaign_id,contact_id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id),
  FOREIGN KEY (tenant_id,contact_id) REFERENCES marketing_ops.lead_contacts(tenant_id,id),
  FOREIGN KEY (tenant_id,campaign_id,first_source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  FOREIGN KEY (tenant_id,campaign_id,captured_source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  CHECK ((classification = 'lead') = (captured_at IS NOT NULL AND captured_source_id IS NOT NULL))
);
CREATE INDEX campaign_leads_captured ON marketing_ops.campaign_leads(tenant_id,captured_at,campaign_id) WHERE captured_at IS NOT NULL;

CREATE TABLE marketing_ops.lead_external_identities (
  tenant_id uuid NOT NULL,
  namespace text NOT NULL CHECK (char_length(namespace) BETWEEN 1 AND 500),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 200),
  contact_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,namespace,external_id),
  FOREIGN KEY (tenant_id,contact_id) REFERENCES marketing_ops.lead_contacts(tenant_id,id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id)
);

CREATE TABLE marketing_ops.lead_import_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  source_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES iam.principals(id),
  source_version bigint NOT NULL,
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array' AND jsonb_array_length(rows) BETWEEN 1 AND 500),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  confirmed_at timestamptz,
  confirmation_hash text,
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,campaign_id,source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  CHECK ((confirmed_at IS NULL) = (receipt IS NULL)),
  CHECK ((confirmed_at IS NULL) = (confirmation_hash IS NULL))
);

CREATE TABLE marketing_ops.lead_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  source_id uuid NOT NULL,
  contact_id uuid,
  receipt_key text NOT NULL CHECK (char_length(receipt_key) BETWEEN 1 AND 300),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  classification text CHECK (classification IN ('cold','lead')),
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('import','form','whatsapp_click')),
  utm jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(utm) = 'object'),
  actor_id uuid REFERENCES iam.principals(id),
  preview_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,source_id,receipt_key),
  FOREIGN KEY (tenant_id,campaign_id,source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  FOREIGN KEY (tenant_id,contact_id) REFERENCES marketing_ops.lead_contacts(tenant_id,id),
  FOREIGN KEY (tenant_id,preview_id) REFERENCES marketing_ops.lead_import_previews(tenant_id,id),
  CHECK ((kind = 'whatsapp_click') = (contact_id IS NULL))
);
CREATE INDEX lead_receipts_period ON marketing_ops.lead_receipts(tenant_id,campaign_id,occurred_at);

CREATE TABLE marketing_ops.lead_capture_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  source_id uuid NOT NULL,
  submission_id text NOT NULL CHECK (char_length(submission_id) BETWEEN 8 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('pending','accepted','skipped')),
  pending_payload jsonb,
  contact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES iam.principals(id),
  UNIQUE (tenant_id,source_id,submission_id),
  FOREIGN KEY (tenant_id,campaign_id,source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  FOREIGN KEY (tenant_id,contact_id) REFERENCES marketing_ops.lead_contacts(tenant_id,id),
  CHECK ((status='pending') = (pending_payload IS NOT NULL)),
  CHECK ((status='accepted') = (contact_id IS NOT NULL))
);

CREATE TABLE marketing_ops.result_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  source_id uuid NOT NULL,
  action_id uuid,
  period_from date NOT NULL,
  period_to date NOT NULL,
  time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 100),
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  notes text CHECK (char_length(notes) <= 4000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES iam.principals(id),
  updated_by uuid NOT NULL REFERENCES iam.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,campaign_id,source_id) REFERENCES marketing_ops.lead_sources(tenant_id,campaign_id,id),
  FOREIGN KEY (tenant_id,action_id) REFERENCES marketing_ops.campaign_items(tenant_id,id),
  CHECK (period_to >= period_from AND period_to - period_from <= 366)
);
CREATE TABLE marketing_ops.result_report_revisions (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  report_id uuid NOT NULL,
  version bigint NOT NULL,
  snapshot jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES iam.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id,version),
  FOREIGN KEY (tenant_id,report_id) REFERENCES marketing_ops.result_reports(tenant_id,id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES marketing_ops.campaigns(tenant_id,id)
);

-- Scope reads and writes to the same campaign authority already used by the
-- product. Contact candidates are visible only through campaigns the actor can
-- read; tenant-wide PII is never exposed to ordinary participants.
DO $$
DECLARE protected_table text;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY['lead_sources','lead_contacts','campaign_leads','lead_external_identities','lead_import_previews','lead_receipts','lead_capture_submissions','result_reports','result_report_revisions'] LOOP
    EXECUTE format('ALTER TABLE marketing_ops.%I ENABLE ROW LEVEL SECURITY', protected_table);
    EXECUTE format('ALTER TABLE marketing_ops.%I FORCE ROW LEVEL SECURITY', protected_table);
    EXECUTE format('CREATE POLICY nexus_owner_all ON marketing_ops.%I FOR ALL TO nexus_owner USING (true) WITH CHECK (true)', protected_table);
  END LOOP;
  FOREACH protected_table IN ARRAY ARRAY['lead_sources','campaign_leads','lead_external_identities','lead_receipts','lead_capture_submissions','result_reports','result_report_revisions'] LOOP
    EXECUTE format('CREATE POLICY lead_read ON marketing_ops.%I FOR SELECT TO nexus_app USING (marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_access_campaign(campaign_id))', protected_table);
    EXECUTE format('CREATE POLICY lead_insert ON marketing_ops.%I FOR INSERT TO nexus_app WITH CHECK (marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id))', protected_table);
  END LOOP;
  FOREACH protected_table IN ARRAY ARRAY['lead_sources','campaign_leads','lead_capture_submissions','result_reports'] LOOP
    EXECUTE format('CREATE POLICY lead_update ON marketing_ops.%I FOR UPDATE TO nexus_app USING (marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id)) WITH CHECK (marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(campaign_id))', protected_table);
  END LOOP;
END $$;
CREATE POLICY contacts_read ON marketing_ops.lead_contacts FOR SELECT TO nexus_app USING (
  marketing_ops_private.row_visible(tenant_id) AND (
    marketing_ops_private.can_access_campaign(origin_campaign_id) OR EXISTS (
      SELECT 1 FROM marketing_ops.campaign_leads link WHERE link.contact_id = lead_contacts.id
        AND link.tenant_id = lead_contacts.tenant_id AND marketing_ops_private.can_access_campaign(link.campaign_id)
    )
  )
);
CREATE POLICY contacts_insert ON marketing_ops.lead_contacts FOR INSERT TO nexus_app WITH CHECK (
  marketing_ops_private.row_visible(tenant_id) AND marketing_ops_private.can_edit_campaign(origin_campaign_id)
);
CREATE POLICY previews_actor ON marketing_ops.lead_import_previews FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id) AND actor_id = app_private.request_user_id() AND marketing_ops_private.can_edit_campaign(campaign_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id) AND actor_id = app_private.request_user_id() AND marketing_ops_private.can_edit_campaign(campaign_id));
GRANT SELECT,INSERT,UPDATE ON marketing_ops.lead_sources,marketing_ops.campaign_leads,marketing_ops.lead_import_previews,marketing_ops.lead_capture_submissions,marketing_ops.result_reports TO nexus_app;
GRANT SELECT,INSERT ON marketing_ops.lead_contacts,marketing_ops.lead_external_identities,marketing_ops.lead_receipts,marketing_ops.result_report_revisions TO nexus_app;

-- Serialize scope validation with source edits and report revisions. No
-- extension-dependent exclusion index is required.
CREATE FUNCTION marketing_ops_private.validate_result_report() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, marketing_ops AS $$
BEGIN
  PERFORM 1 FROM marketing_ops.lead_sources WHERE id = NEW.source_id AND tenant_id = NEW.tenant_id AND campaign_id = NEW.campaign_id FOR UPDATE;
  IF NEW.action_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marketing_ops.campaign_items WHERE id = NEW.action_id AND tenant_id = NEW.tenant_id AND campaign_id = NEW.campaign_id) THEN
    RAISE EXCEPTION 'Report action must belong to its campaign' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM marketing_ops.result_reports report WHERE report.tenant_id = NEW.tenant_id AND report.source_id = NEW.source_id AND (report.action_id IS NOT DISTINCT FROM NEW.action_id OR report.action_id IS NULL OR NEW.action_id IS NULL) AND report.id <> NEW.id AND daterange(report.period_from, report.period_to, '[]') && daterange(NEW.period_from, NEW.period_to, '[]')) THEN
    RAISE EXCEPTION 'Report periods overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_result_report BEFORE INSERT OR UPDATE ON marketing_ops.result_reports FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.validate_result_report();

CREATE FUNCTION marketing_ops_private.validate_lead_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, marketing_ops AS $$
BEGIN
  IF NEW.action_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marketing_ops.campaign_items WHERE id = NEW.action_id AND tenant_id = NEW.tenant_id AND campaign_id = NEW.campaign_id) THEN
    RAISE EXCEPTION 'Source action must belong to its campaign' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id,NEW.campaign_id,NEW.channel,NEW.kind,NEW.classification,NEW.action_id,NEW.external_account_id,NEW.external_campaign_id,NEW.created_by,NEW.public_id) IS DISTINCT FROM (OLD.tenant_id,OLD.campaign_id,OLD.channel,OLD.kind,OLD.classification,OLD.action_id,OLD.external_account_id,OLD.external_campaign_id,OLD.created_by,OLD.public_id) THEN
    RAISE EXCEPTION 'Source attribution fields are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_lead_source BEFORE INSERT OR UPDATE ON marketing_ops.lead_sources FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.validate_lead_source();

-- Anonymous forms have a narrow capability, not an impersonated application
-- actor. The original registering authority is rechecked on every use.
CREATE FUNCTION marketing_ops_private.public_lead_source(capability text)
RETURNS TABLE(id uuid,tenant_id uuid,campaign_id uuid,kind text,classification text,allowed_origins text[],whatsapp_phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, marketing_ops, iam AS $$
  SELECT source.id,source.tenant_id,source.campaign_id,source.kind,source.classification,source.allowed_origins,source.whatsapp_phone
  FROM marketing_ops.lead_sources source
  JOIN marketing_ops.campaigns campaign ON campaign.id = source.campaign_id AND campaign.tenant_id = source.tenant_id
  JOIN iam.principals principal ON principal.id = source.created_by AND principal.disabled_at IS NULL
  JOIN iam.memberships membership ON membership.tenant_id = source.tenant_id AND membership.principal_id = source.created_by AND membership.active
  WHERE source.public_id = capability AND source.enabled AND source.kind <> 'manual' AND campaign.status IN ('planned','active')
    AND (membership.role IN ('admin','manager') OR (membership.role = 'member' AND EXISTS (
      SELECT 1 FROM marketing_ops.campaign_members member WHERE member.tenant_id = source.tenant_id AND member.campaign_id = source.campaign_id AND member.user_id = source.created_by AND member.member_role IN ('owner','editor')
    )))
$$;

CREATE FUNCTION marketing_ops_private.capture_public_lead(capability text,request_origin text,submission_id text,contact_name text,contact_email text,contact_phone text,contact_company text,tracking jsonb,payload_hash text,correlation uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, marketing_ops, marketing_ops_private AS $$
DECLARE source record; existing record; matched record; contact uuid; matching_ids uuid[]; contradictory boolean := false; now_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO source FROM marketing_ops_private.public_lead_source(capability);
  IF NOT FOUND OR source.kind <> 'landing_page' THEN RETURN 'not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-ingestion:'||source.tenant_id::text,0));
  -- Locking the source prevents an in-flight revoke/configuration change from
  -- racing a receipt. Re-read capability after acquiring the lock.
  PERFORM 1 FROM marketing_ops.lead_sources WHERE id = source.id FOR UPDATE;
  SELECT * INTO source FROM marketing_ops_private.public_lead_source(capability);
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF request_origin IS NULL OR NOT (request_origin = ANY(source.allowed_origins)) THEN RETURN 'origin_forbidden'; END IF;
  IF char_length(submission_id) NOT BETWEEN 8 AND 128 OR char_length(btrim(contact_name)) NOT BETWEEN 1 AND 200 OR (contact_email IS NULL AND contact_phone IS NULL) OR (contact_phone IS NOT NULL AND contact_phone !~ '^[1-9][0-9]{7,14}$') OR (contact_email IS NOT NULL AND (char_length(contact_email) > 254 OR contact_email <> lower(contact_email) OR position('@' in contact_email) < 2)) OR char_length(contact_company) > 200 OR payload_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(tracking) <> 'object' THEN
    RETURN 'invalid';
  END IF;
  SELECT * INTO existing FROM marketing_ops.lead_capture_submissions entry WHERE entry.tenant_id = source.tenant_id AND entry.source_id = source.id AND entry.submission_id = capture_public_lead.submission_id;
  IF FOUND THEN
    IF existing.payload_hash <> payload_hash THEN RETURN 'conflict'; END IF;
    RETURN 'accepted';
  END IF;
  SELECT array_agg(candidate.id) INTO matching_ids FROM marketing_ops.lead_contacts candidate WHERE candidate.tenant_id=source.tenant_id AND ((contact_email IS NOT NULL AND candidate.email=contact_email) OR (contact_phone IS NOT NULL AND candidate.phone=contact_phone));
  IF cardinality(matching_ids) = 1 THEN
    SELECT candidate.email,candidate.phone INTO matched FROM marketing_ops.lead_contacts candidate WHERE candidate.id=matching_ids[1] AND candidate.tenant_id=source.tenant_id FOR UPDATE;
    contradictory := (contact_email IS NOT NULL AND matched.email IS NOT NULL AND contact_email <> matched.email)
      OR (contact_phone IS NOT NULL AND matched.phone IS NOT NULL AND contact_phone <> matched.phone);
  END IF;
  IF cardinality(matching_ids) > 1 OR contradictory THEN
    INSERT INTO marketing_ops.lead_capture_submissions(tenant_id,campaign_id,source_id,submission_id,payload_hash,status,pending_payload)
      VALUES(source.tenant_id,source.campaign_id,source.id,submission_id,payload_hash,'pending',jsonb_build_object('name',contact_name,'email',contact_email,'phone',contact_phone,'company',contact_company,'utm',tracking));
    INSERT INTO marketing_ops.audit_events(tenant_id,origin,actor_type,entity_type,entity_id,action,after_state,correlation_id)
      VALUES(source.tenant_id,'internal','user','campaign',source.campaign_id,'lead.form_review_pending',jsonb_build_object('sourceId',source.id),correlation);
    RETURN 'accepted';
  END IF;
  contact := matching_ids[1];
  IF contact IS NULL THEN
    contact := gen_random_uuid();
    INSERT INTO marketing_ops.lead_contacts(id,tenant_id,origin_campaign_id,origin_source_id,name,email,phone,company,first_occurred_at)
      VALUES(contact,source.tenant_id,source.campaign_id,source.id,contact_name,contact_email,contact_phone,contact_company,now_at);
  ELSE
    -- The tenant ingestion lock serializes all supported identity writes. A
    -- consistent exact candidate can gain missing identifiers; populated data,
    -- first origin and name are never overwritten by an anonymous form.
    UPDATE marketing_ops.lead_contacts candidate
      SET email=coalesce(candidate.email,contact_email),phone=coalesce(candidate.phone,contact_phone),
          company=coalesce(nullif(btrim(candidate.company),''),nullif(btrim(contact_company),''))
      WHERE candidate.id=contact AND candidate.tenant_id=source.tenant_id;
  END IF;
  INSERT INTO marketing_ops.campaign_leads(tenant_id,campaign_id,contact_id,first_source_id,captured_source_id,classification,first_occurred_at,captured_at)
    VALUES(source.tenant_id,source.campaign_id,contact,source.id,CASE WHEN source.classification='lead' THEN source.id END,source.classification,now_at,CASE WHEN source.classification='lead' THEN now_at END)
    ON CONFLICT(campaign_id,contact_id) DO UPDATE SET classification=CASE WHEN campaign_leads.classification='lead' OR excluded.classification='lead' THEN 'lead' ELSE 'cold' END,captured_at=coalesce(campaign_leads.captured_at,excluded.captured_at),captured_source_id=coalesce(campaign_leads.captured_source_id,excluded.captured_source_id),updated_at=now();
  INSERT INTO marketing_ops.lead_receipts(tenant_id,campaign_id,source_id,contact_id,receipt_key,payload_hash,classification,occurred_at,kind,utm)
    VALUES(source.tenant_id,source.campaign_id,source.id,contact,'submission:'||submission_id,payload_hash,source.classification,now_at,'form',tracking);
  INSERT INTO marketing_ops.lead_capture_submissions(tenant_id,campaign_id,source_id,submission_id,payload_hash,status,contact_id,resolved_at)
    VALUES(source.tenant_id,source.campaign_id,source.id,submission_id,payload_hash,'accepted',contact,now_at);
  INSERT INTO marketing_ops.audit_events(tenant_id,origin,actor_type,entity_type,entity_id,action,after_state,correlation_id)
    VALUES(source.tenant_id,'internal','user','campaign',source.campaign_id,'lead.form_received',jsonb_build_object('sourceId',source.id,'contactId',contact),correlation);
  RETURN 'accepted';
END $$;

CREATE FUNCTION marketing_ops_private.record_public_whatsapp_click(capability text,correlation uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, marketing_ops, marketing_ops_private AS $$
DECLARE source record;
BEGIN
  SELECT * INTO source FROM marketing_ops_private.public_lead_source(capability);
  IF NOT FOUND OR source.kind <> 'whatsapp' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-ingestion:'||source.tenant_id::text,0));
  PERFORM 1 FROM marketing_ops.lead_sources WHERE id = source.id FOR UPDATE;
  SELECT * INTO source FROM marketing_ops_private.public_lead_source(capability);
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO marketing_ops.lead_receipts(tenant_id,campaign_id,source_id,receipt_key,payload_hash,occurred_at,kind)
    VALUES(source.tenant_id,source.campaign_id,source.id,'click:'||gen_random_uuid()::text,repeat('0',64),clock_timestamp(),'whatsapp_click');
  RETURN source.whatsapp_phone;
END $$;

REVOKE ALL ON FUNCTION marketing_ops_private.validate_lead_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.validate_result_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.public_lead_source(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.capture_public_lead(text,text,text,text,text,text,text,jsonb,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_ops_private.record_public_whatsapp_click(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketing_ops_private.public_lead_source(text) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.capture_public_lead(text,text,text,text,text,text,text,jsonb,text,uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION marketing_ops_private.record_public_whatsapp_click(text,uuid) TO nexus_app;
