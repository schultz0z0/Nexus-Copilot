CREATE TABLE marketing_ops.prepared_agent_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  prepared_by uuid NOT NULL REFERENCES iam.principals(id),
  chat_session_id uuid NOT NULL,
  source_run_id uuid NOT NULL,
  prepared_delegation_jti text,
  plan_hash text NOT NULL,
  actions jsonb NOT NULL,
  required_scopes text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  execution_key text,
  execution_started_at timestamptz,
  execution_attempts integer NOT NULL DEFAULT 0,
  result jsonb,
  executed_by uuid REFERENCES iam.principals(id),
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT prepared_agent_plans_actions_check CHECK (
    jsonb_typeof(actions) = 'array'
    AND jsonb_array_length(actions) > 0
    AND jsonb_array_length(actions) <= 20
  ),
  CONSTRAINT prepared_agent_plans_plan_hash_check CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT prepared_agent_plans_status_check CHECK (
    status IN ('pending', 'executing', 'completed', 'partial', 'failed', 'expired', 'invalidated')
  ),
  CONSTRAINT prepared_agent_plans_expires_check CHECK (expires_at > created_at),
  CONSTRAINT prepared_agent_plans_attempts_check CHECK (execution_attempts >= 0 AND execution_attempts <= 10),
  CONSTRAINT prepared_agent_plans_result_check CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CONSTRAINT prepared_agent_plans_execution_key_unique UNIQUE (tenant_id, execution_key)
);

CREATE INDEX idx_prepared_agent_plans_pending
  ON marketing_ops.prepared_agent_plans (tenant_id, prepared_by, chat_session_id, expires_at)
  WHERE status = 'pending';

CREATE INDEX idx_prepared_agent_plans_source_run
  ON marketing_ops.prepared_agent_plans (tenant_id, prepared_by, source_run_id, plan_hash);

ALTER TABLE marketing_ops.prepared_agent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_ops.prepared_agent_plans FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE marketing_ops.prepared_agent_plans FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE marketing_ops.prepared_agent_plans TO nexus_app;

CREATE POLICY nexus_owner_all ON marketing_ops.prepared_agent_plans
  FOR ALL TO nexus_owner USING (true) WITH CHECK (true);

CREATE POLICY prepared_agent_plans_tenant_all ON marketing_ops.prepared_agent_plans
  FOR ALL TO nexus_app
  USING (marketing_ops_private.row_visible(tenant_id))
  WITH CHECK (marketing_ops_private.row_visible(tenant_id));

CREATE FUNCTION marketing_ops_private.enforce_prepared_agent_plan_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by
     OR NEW.chat_session_id IS DISTINCT FROM OLD.chat_session_id
     OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
     OR NEW.plan_hash IS DISTINCT FROM OLD.plan_hash
     OR NEW.actions IS DISTINCT FROM OLD.actions
     OR NEW.required_scopes IS DISTINCT FROM OLD.required_scopes
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'prepared plan core fields are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('completed', 'partial', 'failed', 'expired', 'invalidated') THEN
      RAISE EXCEPTION 'prepared plan in terminal state % cannot transition to %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'pending' AND NEW.status NOT IN ('executing', 'expired', 'invalidated') THEN
      RAISE EXCEPTION 'invalid transition from pending: %', NEW.status USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'executing' AND NEW.status NOT IN ('completed', 'partial', 'failed', 'executing') THEN
      RAISE EXCEPTION 'invalid transition from executing: %', NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION marketing_ops_private.enforce_prepared_agent_plan_integrity() FROM PUBLIC;

CREATE TRIGGER prepared_agent_plans_immutable_integrity
BEFORE UPDATE ON marketing_ops.prepared_agent_plans
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.enforce_prepared_agent_plan_integrity();

CREATE TRIGGER prepared_agent_plans_reject_delete
BEFORE DELETE ON marketing_ops.prepared_agent_plans
FOR EACH ROW EXECUTE FUNCTION marketing_ops_private.reject_append_only_change();
