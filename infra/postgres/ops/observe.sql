\set ON_ERROR_STOP on

SELECT json_build_object(
  'available', true,
  'server_version', version(),
  'database_size_bytes', pg_database_size(current_database()),
  'connections_used', (
    SELECT count(*)::int
    FROM pg_stat_activity
    WHERE datname = current_database()
  ),
  'connections_limit', current_setting('max_connections')::int,
  'waiting_locks', (
    SELECT count(*)::int
    FROM pg_locks
    WHERE NOT granted
  ),
  'long_running_transactions', (
    SELECT count(*)::int
    FROM pg_stat_activity
    WHERE state = 'active'
      AND xact_start IS NOT NULL
      AND (clock_timestamp() - xact_start) > interval '30 seconds'
  ),
  'latest_migration_version', (
    SELECT version
    FROM infra.schema_migrations
    ORDER BY version DESC
    LIMIT 1
  )
)::text;
