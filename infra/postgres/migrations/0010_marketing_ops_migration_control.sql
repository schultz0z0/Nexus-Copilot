CREATE SCHEMA migration_control AUTHORIZATION nexus_owner;

CREATE TABLE migration_control.marketing_ops_runs (
  id uuid PRIMARY KEY,
  manifest_fingerprint text NOT NULL UNIQUE CHECK (manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('loading', 'completed', 'failed')),
  source_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_manifest) = 'object'),
  table_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(table_counts) = 'object'),
  started_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  CONSTRAINT marketing_ops_runs_completion_check CHECK (
    (status = 'completed') = (completed_at IS NOT NULL)
  )
);

CREATE TABLE migration_control.marketing_ops_staging_rows (
  run_id uuid NOT NULL REFERENCES migration_control.marketing_ops_runs (id) ON DELETE CASCADE,
  table_name text NOT NULL,
  source_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  loaded_at timestamptz,
  PRIMARY KEY (run_id, table_name, source_id)
);

CREATE INDEX marketing_ops_staging_pending_idx
  ON migration_control.marketing_ops_staging_rows (run_id, table_name, source_id)
  WHERE loaded_at IS NULL;

REVOKE ALL ON SCHEMA migration_control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA migration_control FROM PUBLIC;
GRANT USAGE ON SCHEMA migration_control TO nexus_migrator;

