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
