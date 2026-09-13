CREATE SCHEMA marketing_ops AUTHORIZATION nexus_owner;
CREATE SCHEMA marketing_ops_private AUTHORIZATION nexus_owner;

CREATE TYPE marketing_ops.campaign_status AS ENUM ('draft', 'planned', 'active', 'completed', 'archived');
CREATE TYPE marketing_ops.campaign_channel AS ENUM (
  'email', 'instagram', 'linkedin', 'facebook', 'whatsapp',
  'website', 'paid_media', 'events', 'press', 'other'
);
CREATE TYPE marketing_ops.reference_type AS ENUM ('course', 'product', 'initiative');
CREATE TYPE marketing_ops.campaign_member_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE marketing_ops.campaign_material_source AS ENUM ('upload', 'existing_artifact');
CREATE TYPE marketing_ops.item_kind AS ENUM ('task', 'email', 'whatsapp', 'post', 'creative', 'review', 'milestone');
CREATE TYPE marketing_ops.item_status AS ENUM ('draft', 'ready', 'in_review', 'completed', 'cancelled');
CREATE TYPE marketing_ops.item_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE marketing_ops.item_channel AS ENUM (
  'email', 'instagram', 'linkedin', 'facebook', 'whatsapp',
  'website', 'paid_media', 'events', 'press', 'other'
);
CREATE TYPE marketing_ops.approval_kind AS ENUM ('editorial', 'operational');
CREATE TYPE marketing_ops.approval_status AS ENUM (
  'pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired'
);
CREATE TYPE marketing_ops.approval_risk AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE marketing_ops.action_package_status AS ENUM ('pending_approval', 'authorized', 'invalidated', 'expired');
CREATE TYPE marketing_ops.idempotency_status AS ENUM ('processing', 'completed', 'failed');
CREATE TYPE marketing_ops.actor_type AS ENUM ('user', 'service');
CREATE TYPE marketing_ops.origin_type AS ENUM ('rest', 'mcp', 'internal', 'migration');

CREATE TABLE marketing_ops.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  objective text,
  audience text,
  briefing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(briefing) = 'object'),
  reference_type marketing_ops.reference_type,
  reference_key text,
  reference_title_snapshot text,
  reference_document_id uuid,
  reference_verified_at timestamptz,
  course_slug text,
  primary_channel marketing_ops.campaign_channel,
  secondary_channels marketing_ops.campaign_channel[] NOT NULL DEFAULT '{}',
  starts_on date,
  ends_on date,
  notes text,
  status marketing_ops.campaign_status NOT NULL DEFAULT 'draft',
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  updated_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(objective, '') || ' ' || coalesce(audience, ''))
  ) STORED,
  CONSTRAINT campaigns_date_order_check CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT campaigns_archive_status_check CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CONSTRAINT campaigns_reference_check CHECK (
    (reference_type IS NULL AND reference_key IS NULL AND reference_title_snapshot IS NULL)
    OR (reference_type IS NOT NULL AND reference_title_snapshot IS NOT NULL)
  ),
  CONSTRAINT campaigns_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE marketing_ops.campaign_members (
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES iam.principals (id),
  member_role marketing_ops.campaign_member_role NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (campaign_id, user_id),
  CONSTRAINT campaign_members_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT campaign_members_primary_owner_check CHECK (NOT is_primary OR member_role = 'owner')
);

CREATE TABLE marketing_ops.campaign_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  artifact_owner_id uuid NOT NULL REFERENCES iam.principals (id),
  source marketing_ops.campaign_material_source NOT NULL,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  unlinked_by uuid REFERENCES iam.principals (id),
  unlinked_at timestamptz,
  CONSTRAINT campaign_materials_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT campaign_materials_unlink_check CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL)),
  CONSTRAINT campaign_materials_active_artifact_unique UNIQUE NULLS NOT DISTINCT (tenant_id, campaign_id, artifact_id, unlinked_at)
);

CREATE TABLE marketing_ops.campaign_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  kind marketing_ops.item_kind NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text,
  content text,
  status marketing_ops.item_status NOT NULL DEFAULT 'draft',
  priority marketing_ops.item_priority NOT NULL DEFAULT 'normal',
  channel marketing_ops.item_channel,
  assignee_user_id uuid REFERENCES iam.principals (id),
  starts_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  updated_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT campaign_items_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT campaign_items_schedule_check CHECK (due_at IS NULL OR starts_at IS NULL OR due_at >= starts_at),
  CONSTRAINT campaign_items_terminal_timestamps_check CHECK (
    (status = 'completed') = (completed_at IS NOT NULL)
    AND (status = 'cancelled') = (cancelled_at IS NOT NULL)
  ),
  CONSTRAINT campaign_items_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE marketing_ops.item_dependencies (
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  item_id uuid NOT NULL,
  depends_on_item_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (item_id, depends_on_item_id),
  CONSTRAINT item_dependencies_item_fk FOREIGN KEY (tenant_id, item_id)
    REFERENCES marketing_ops.campaign_items (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT item_dependencies_parent_fk FOREIGN KEY (tenant_id, depends_on_item_id)
    REFERENCES marketing_ops.campaign_items (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT item_dependencies_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT item_dependencies_not_self CHECK (item_id <> depends_on_item_id)
);

CREATE TABLE marketing_ops.content_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  item_id uuid NOT NULL,
  asset_kind text NOT NULL CHECK (char_length(asset_kind) BETWEEN 1 AND 100),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  current_version_number integer NOT NULL DEFAULT 0 CHECK (current_version_number >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  updated_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT content_assets_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT content_assets_item_fk FOREIGN KEY (tenant_id, item_id)
    REFERENCES marketing_ops.campaign_items (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT content_assets_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE marketing_ops.content_versions (
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  asset_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  frozen_at timestamptz,
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (asset_id, version_number),
  CONSTRAINT content_versions_asset_fk FOREIGN KEY (tenant_id, asset_id)
    REFERENCES marketing_ops.content_assets (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT content_versions_tenant_asset_version_unique UNIQUE (tenant_id, asset_id, version_number)
);

CREATE TABLE marketing_ops.item_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  item_id uuid NOT NULL,
  asset_id uuid,
  artifact_id uuid NOT NULL,
  artifact_owner_id uuid NOT NULL REFERENCES iam.principals (id),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  unlinked_by uuid REFERENCES iam.principals (id),
  unlinked_at timestamptz,
  CONSTRAINT item_artifacts_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT item_artifacts_item_fk FOREIGN KEY (tenant_id, item_id)
    REFERENCES marketing_ops.campaign_items (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT item_artifacts_asset_fk FOREIGN KEY (tenant_id, asset_id)
    REFERENCES marketing_ops.content_assets (tenant_id, id),
  CONSTRAINT item_artifacts_unlink_check CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL)),
  CONSTRAINT item_artifacts_active_artifact_unique UNIQUE NULLS NOT DISTINCT (tenant_id, item_id, artifact_id, unlinked_at)
);

CREATE TABLE marketing_ops.action_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES iam.principals (id),
  action_type text NOT NULL CHECK (char_length(action_type) BETWEEN 1 AND 100),
  channel text NOT NULL CHECK (char_length(channel) BETWEEN 1 AND 64),
  audience_snapshot jsonb NOT NULL CHECK (jsonb_typeof(audience_snapshot) = 'object'),
  scheduled_for timestamptz,
  time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 100),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  success_criteria text,
  risk_summary text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status marketing_ops.action_package_status NOT NULL DEFAULT 'pending_approval',
  authorized_by_request_id uuid,
  authorized_at timestamptz,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  invalidation_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT action_packages_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT action_packages_tenant_id_id_unique UNIQUE (tenant_id, id)
);

CREATE TABLE marketing_ops.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  campaign_id uuid NOT NULL,
  kind marketing_ops.approval_kind NOT NULL,
  status marketing_ops.approval_status NOT NULL DEFAULT 'pending',
  risk_level marketing_ops.approval_risk NOT NULL DEFAULT 'low',
  requested_by uuid NOT NULL REFERENCES iam.principals (id),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 4000),
  content_asset_id uuid,
  content_version_number integer,
  action_package_id uuid,
  target_hash text NOT NULL CHECK (target_hash ~ '^[0-9a-f]{64}$'),
  supersedes_request_id uuid,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT approval_requests_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT approval_requests_content_version_fk FOREIGN KEY (tenant_id, content_asset_id, content_version_number)
    REFERENCES marketing_ops.content_versions (tenant_id, asset_id, version_number),
  CONSTRAINT approval_requests_action_package_fk FOREIGN KEY (tenant_id, action_package_id)
    REFERENCES marketing_ops.action_packages (tenant_id, id),
  CONSTRAINT approval_requests_supersedes_fk FOREIGN KEY (tenant_id, supersedes_request_id)
    REFERENCES marketing_ops.approval_requests (tenant_id, id),
  CONSTRAINT approval_requests_target_matches_kind CHECK (
    (kind = 'editorial' AND content_asset_id IS NOT NULL AND content_version_number IS NOT NULL AND action_package_id IS NULL)
    OR (kind = 'operational' AND action_package_id IS NOT NULL AND content_asset_id IS NULL AND content_version_number IS NULL)
  ),
  CONSTRAINT approval_requests_tenant_id_id_unique UNIQUE (tenant_id, id)
);

ALTER TABLE marketing_ops.action_packages
  ADD CONSTRAINT action_packages_authorized_request_fk
  FOREIGN KEY (tenant_id, authorized_by_request_id)
  REFERENCES marketing_ops.approval_requests (tenant_id, id);

CREATE TABLE marketing_ops.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  request_id uuid NOT NULL,
  decision marketing_ops.approval_status NOT NULL,
  comment text,
  decided_by uuid REFERENCES iam.principals (id),
  decider_role text,
  decision_origin text NOT NULL DEFAULT 'user',
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligibility_snapshot) = 'object'),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT approval_decisions_request_fk FOREIGN KEY (tenant_id, request_id)
    REFERENCES marketing_ops.approval_requests (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT approval_decisions_terminal_check CHECK (decision IN ('approved', 'rejected', 'changes_requested', 'cancelled', 'expired')),
  CONSTRAINT approval_decisions_comment_check CHECK (decision = 'approved' OR nullif(btrim(comment), '') IS NOT NULL)
);

CREATE TABLE marketing_ops.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  actor_user_id uuid REFERENCES iam.principals (id),
  actor_role text,
  actor_type marketing_ops.actor_type NOT NULL DEFAULT 'user',
  origin marketing_ops.origin_type NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  correlation_id uuid NOT NULL,
  operator_origin text,
  chat_session_id uuid,
  run_id uuid,
  tool_name text,
  tool_call_id text,
  plan_id uuid,
  plan_action_index integer,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE marketing_ops.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error text
);

CREATE TABLE marketing_ops.idempotency_records (
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  actor_id uuid NOT NULL REFERENCES iam.principals (id),
  operation text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status marketing_ops.idempotency_status NOT NULL DEFAULT 'processing',
  response_ref jsonb,
  response_status integer,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, actor_id, operation, idempotency_key)
);

CREATE TABLE marketing_ops.delegation_uses (
  jti text PRIMARY KEY CHECK (char_length(jti) >= 8),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  actor_id uuid NOT NULL REFERENCES iam.principals (id),
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id, actor_id, operation, idempotency_key)
);

CREATE TABLE marketing_ops.in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants (id),
  user_id uuid NOT NULL REFERENCES iam.principals (id),
  event_key text NOT NULL,
  notification_type text NOT NULL,
  campaign_id uuid,
  item_id uuid,
  approval_request_id uuid,
  label text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  read_at timestamptz,
  CONSTRAINT in_app_notifications_campaign_fk FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES marketing_ops.campaigns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT in_app_notifications_item_fk FOREIGN KEY (tenant_id, item_id)
    REFERENCES marketing_ops.campaign_items (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT in_app_notifications_approval_fk FOREIGN KEY (tenant_id, approval_request_id)
    REFERENCES marketing_ops.approval_requests (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, event_key)
);

REVOKE ALL ON SCHEMA marketing_ops FROM PUBLIC;
REVOKE ALL ON SCHEMA marketing_ops_private FROM PUBLIC;

