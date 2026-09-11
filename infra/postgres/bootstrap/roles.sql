\set ON_ERROR_STOP on
\getenv database_name PGDATABASE
\getenv nexus_migrator_password NEXUS_MIGRATOR_PASSWORD
\getenv nexus_app_password NEXUS_APP_PASSWORD
\getenv nexus_backup_password NEXUS_BACKUP_PASSWORD

SELECT 'CREATE ROLE nexus_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nexus_owner')
\gexec

SELECT 'CREATE ROLE nexus_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nexus_migrator')
\gexec

SELECT 'CREATE ROLE nexus_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app')
\gexec

SELECT 'CREATE ROLE nexus_backup'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'nexus_backup')
\gexec

ALTER ROLE nexus_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER ROLE nexus_migrator
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER ROLE nexus_app
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER ROLE nexus_backup
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;

SELECT format('ALTER ROLE nexus_migrator PASSWORD %L', :'nexus_migrator_password')
\gexec

SELECT format('ALTER ROLE nexus_app PASSWORD %L', :'nexus_app_password')
\gexec

SELECT format('ALTER ROLE nexus_backup PASSWORD %L', :'nexus_backup_password')
\gexec

GRANT nexus_owner TO nexus_migrator WITH INHERIT FALSE, SET TRUE;
REVOKE nexus_owner FROM nexus_app;

REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO nexus_migrator, nexus_app;
GRANT CONNECT ON DATABASE :"database_name" TO nexus_backup;
GRANT pg_read_all_data TO nexus_backup WITH INHERIT TRUE;
GRANT CREATE ON DATABASE :"database_name" TO nexus_owner;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

ALTER ROLE nexus_app SET statement_timeout = '30s';
ALTER ROLE nexus_app SET lock_timeout = '5s';
ALTER ROLE nexus_app SET idle_in_transaction_session_timeout = '30s';

