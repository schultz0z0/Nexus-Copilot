-- 0004_chat_store.sql

-- IAM Schema Evolutions
ALTER TABLE iam.principals ADD COLUMN email text;
ALTER TABLE iam.principals ADD COLUMN full_name text;

CREATE TABLE iam.user_chat_integrations (
  user_id uuid PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
  hermes_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_by uuid REFERENCES iam.principals(id)
);

-- Chat Schema Creation
CREATE SCHEMA chat AUTHORIZATION nexus_owner;
REVOKE ALL ON SCHEMA chat FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_owner IN SCHEMA chat REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_owner IN SCHEMA chat REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_owner IN SCHEMA chat REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE chat.chat_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  title text,
  session_kind text,
  user_message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_session_summaries (
  session_id uuid PRIMARY KEY REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  summary text,
  last_user_message_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_confidence_logs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  answer_model text,
  avg_score numeric,
  confidence_score numeric,
  issues jsonb,
  iterations integer,
  mode text,
  review_state text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.chat_session_hermes_state (
  chat_session_id uuid PRIMARY KEY REFERENCES chat.chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  hermes_session_id text,
  hermes_conversation_id text,
  last_response_id text,
  last_good_response_id text,
  chain_health text NOT NULL DEFAULT 'healthy',
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE chat.bridge_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- RLS
GRANT USAGE ON SCHEMA chat TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA chat TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.user_chat_integrations TO nexus_app;

ALTER TABLE iam.user_chat_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_confidence_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.chat_session_hermes_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.bridge_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY nexus_app_all ON chat.chat_sessions TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_messages TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_session_summaries TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_confidence_logs TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.chat_session_hermes_state TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON chat.bridge_runs TO nexus_app USING (true) WITH CHECK (true);
CREATE POLICY nexus_app_all ON iam.user_chat_integrations TO nexus_app USING (true) WITH CHECK (true);
