-- 0005_auth_sessions.sql

-- IAM Authentication Credentials
CREATE TABLE iam.user_credentials (
  user_id uuid PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  algorithm text NOT NULL DEFAULT 'bcrypt',
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- IAM User Sessions (Opaque Bearer Token Hash)
CREATE TABLE iam.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  ip_address text,
  user_agent text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX user_sessions_user_id_idx ON iam.user_sessions(user_id);
CREATE INDEX user_sessions_expires_at_idx ON iam.user_sessions(expires_at);
CREATE INDEX user_sessions_session_token_hash_idx ON iam.user_sessions(session_token_hash);

-- Triggers for updated_at
CREATE TRIGGER user_credentials_updated_at_trigger
BEFORE UPDATE ON iam.user_credentials
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();

CREATE TRIGGER user_sessions_updated_at_trigger
BEFORE UPDATE ON iam.user_sessions
FOR EACH ROW EXECUTE FUNCTION infra.set_current_timestamp_updated_at();

-- Grants to nexus_app
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.user_credentials TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.user_sessions TO nexus_app;

-- RLS for Credentials and Sessions
ALTER TABLE iam.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_credentials FORCE ROW LEVEL SECURITY;

ALTER TABLE iam.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY nexus_app_all ON iam.user_credentials TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON iam.user_sessions TO nexus_app USING (true) WITH CHECK (true);

-- Hardening of Chat Domain RLS Policies
DROP POLICY IF EXISTS nexus_app_all ON chat.chat_sessions;
DROP POLICY IF EXISTS nexus_app_all ON chat.chat_messages;
DROP POLICY IF EXISTS nexus_app_all ON chat.chat_session_summaries;
DROP POLICY IF EXISTS nexus_app_all ON chat.chat_confidence_logs;
DROP POLICY IF EXISTS nexus_app_all ON chat.chat_session_hermes_state;
DROP POLICY IF EXISTS nexus_app_all ON chat.bridge_runs;

CREATE POLICY chat_sessions_user_isolation ON chat.chat_sessions TO nexus_app
  USING (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  )
  WITH CHECK (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  );

CREATE POLICY chat_messages_user_isolation ON chat.chat_messages TO nexus_app
  USING (
    app_private.request_user_id() IS NULL
    OR session_id IN (
      SELECT id FROM chat.chat_sessions
      WHERE user_id = app_private.request_user_id()
    )
  )
  WITH CHECK (
    app_private.request_user_id() IS NULL
    OR session_id IN (
      SELECT id FROM chat.chat_sessions
      WHERE user_id = app_private.request_user_id()
    )
  );

CREATE POLICY chat_session_summaries_user_isolation ON chat.chat_session_summaries TO nexus_app
  USING (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  )
  WITH CHECK (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  );

CREATE POLICY chat_confidence_logs_user_isolation ON chat.chat_confidence_logs TO nexus_app
  USING (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  )
  WITH CHECK (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  );

CREATE POLICY chat_session_hermes_state_user_isolation ON chat.chat_session_hermes_state TO nexus_app
  USING (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  )
  WITH CHECK (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  );

CREATE POLICY bridge_runs_user_isolation ON chat.bridge_runs TO nexus_app
  USING (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  )
  WITH CHECK (
    app_private.request_user_id() IS NULL
    OR user_id = app_private.request_user_id()
  );

ALTER TABLE chat.chat_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_session_summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_confidence_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_session_hermes_state FORCE ROW LEVEL SECURITY;
ALTER TABLE chat.bridge_runs FORCE ROW LEVEL SECURITY;

-- Authentication and Session Lookup Functions
-- SECURITY DEFINER allows nexus_app to authenticate unauthenticated clients without violating RLS
CREATE FUNCTION iam.authenticate_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  password_hash text,
  algorithm text,
  failed_login_attempts integer,
  locked_until timestamptz,
  tenant_id uuid,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT p.id, p.email, p.full_name, c.password_hash, c.algorithm,
         c.failed_login_attempts, c.locked_until,
         m.tenant_id, m.role
  FROM iam.principals p
  JOIN iam.user_credentials c ON c.user_id = p.id
  LEFT JOIN iam.memberships m ON m.principal_id = p.id AND m.active = true
  WHERE lower(p.email) = lower(p_email)
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

CREATE FUNCTION iam.resolve_session(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  expires_at timestamptz,
  email text,
  full_name text,
  tenant_id uuid,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
  SELECT s.id AS session_id, s.user_id, s.expires_at,
         p.email, p.full_name,
         m.tenant_id, m.role
  FROM iam.user_sessions s
  JOIN iam.principals p ON s.user_id = p.id
  LEFT JOIN iam.memberships m ON m.principal_id = p.id AND m.active = true
  WHERE s.session_token_hash = p_token_hash
    AND s.expires_at > transaction_timestamp()
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION iam.authenticate_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.resolve_session(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION iam.authenticate_by_email(text) TO nexus_app;
GRANT EXECUTE ON FUNCTION iam.resolve_session(text) TO nexus_app;

