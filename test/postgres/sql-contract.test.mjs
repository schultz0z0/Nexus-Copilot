import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const rolesFile = join(repositoryRoot, 'infra', 'postgres', 'bootstrap', 'roles.sql');
const bootstrapScript = join(
  repositoryRoot,
  'infra',
  'postgres',
  'scripts',
  'bootstrap-roles.sh',
);
const migrationsDirectory = join(repositoryRoot, 'infra', 'postgres', 'migrations');

function migration(name) {
  return readFileSync(join(migrationsDirectory, name), 'utf8');
}

function compactSql(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

test('bootstrap declares separate owner, migrator and app roles with least privilege', () => {
  const sql = compactSql(readFileSync(rolesFile, 'utf8'));

  for (const role of ['nexus_owner', 'nexus_migrator', 'nexus_app']) {
    assert.match(sql, new RegExp(`alter role ${role} .*nosuperuser`));
    assert.match(sql, new RegExp(`alter role ${role} .*nocreatedb`));
    assert.match(sql, new RegExp(`alter role ${role} .*nocreaterole`));
    assert.match(sql, new RegExp(`alter role ${role} .*noreplication`));
    assert.match(sql, new RegExp(`alter role ${role} .*nobypassrls`));
  }

  assert.match(sql, /alter role nexus_owner nologin/);
  assert.match(sql, /alter role nexus_migrator login .*noinherit/);
  assert.match(sql, /alter role nexus_app login .*noinherit/);
  assert.match(sql, /alter role nexus_backup login .*bypassrls/);
  assert.match(
    sql,
    /grant nexus_owner to nexus_migrator with inherit false, set true/,
  );
  assert.match(sql, /revoke nexus_owner from nexus_app/);
  assert.doesNotMatch(sql, /grant nexus_owner to nexus_app/);
});

test('bootstrap removes public creation rights and grants only required database access', () => {
  const sql = compactSql(readFileSync(rolesFile, 'utf8'));

  assert.match(sql, /revoke all on database :"database_name" from public/);
  assert.match(sql, /revoke all on schema public from public/);
  assert.match(sql, /grant connect on database :"database_name" to nexus_migrator, nexus_app/);
  assert.match(sql, /grant connect on database :"database_name" to nexus_backup/);
  assert.match(sql, /grant pg_read_all_data to nexus_backup/);
  assert.match(sql, /grant create on database :"database_name" to nexus_owner/);
  assert.doesNotMatch(sql, /grant .*create.* to nexus_backup/);
});

test('bootstrap obtains passwords from process environment without embedding or echoing them', () => {
  const sql = readFileSync(rolesFile, 'utf8');
  const script = readFileSync(bootstrapScript, 'utf8');

  assert.match(sql, /\\getenv nexus_migrator_password NEXUS_MIGRATOR_PASSWORD/);
  assert.match(sql, /\\getenv nexus_app_password NEXUS_APP_PASSWORD/);
  assert.match(sql, /\\getenv nexus_backup_password NEXUS_BACKUP_PASSWORD/);
  assert.doesNotMatch(sql, /PASSWORD\s+'[^']+'/i);

  assert.match(script, /^set -eu$/m);
  assert.match(script, /\/run\/secrets\/postgres_bootstrap_password/);
  assert.match(script, /\/run\/secrets\/postgres_migrator_password/);
  assert.match(script, /\/run\/secrets\/postgres_app_password/);
  assert.match(script, /\/run\/secrets\/postgres_backup_password/);
  assert.match(script, /NEXUS_BACKUP_PASSWORD/);
  assert.match(script, /^exec psql -X --set ON_ERROR_STOP=1 /m);
  assert.doesNotMatch(script, /echo|set -x|-v\s+\w*password/i);
});

test('foundation migration creates private schemas with restrictive defaults', () => {
  const sql = compactSql(migration('0001_foundation_schemas.sql'));

  for (const schema of ['iam', 'app_private', 'audit']) {
    assert.match(sql, new RegExp(`create schema ${schema} authorization nexus_owner`));
    assert.match(sql, new RegExp(`revoke all on schema ${schema} from public`));
    assert.match(
      sql,
      new RegExp(
        `alter default privileges for role nexus_owner in schema ${schema} revoke all on tables from public`,
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `alter default privileges for role nexus_owner in schema ${schema} revoke execute on functions from public`,
      ),
    );
  }
});

test('IAM migration defines constrained tenant, principal and membership records', () => {
  const sql = compactSql(migration('0002_iam_tenancy.sql'));

  assert.match(sql, /create table iam\.tenants \( id uuid primary key/);
  assert.match(sql, /create table iam\.principals \( id uuid primary key/);
  assert.match(sql, /create table iam\.memberships \(/);
  assert.match(sql, /primary key \(tenant_id, principal_id\)/);
  assert.match(sql, /foreign key \(tenant_id\) references iam\.tenants \(id\)/);
  assert.match(sql, /foreign key \(principal_id\) references iam\.principals \(id\)/);
  assert.match(sql, /check \(role in \('member', 'manager', 'admin'\)\)/);
  assert.match(sql, /created_at timestamptz not null default transaction_timestamp\(\)/);
  assert.match(sql, /create index memberships_principal_id_idx on iam\.memberships \(principal_id\)/);
  assert.match(sql, /create index memberships_active_tenant_idx on iam\.memberships \(tenant_id, principal_id\) where active/);
});

test('RLS migration uses transaction-local context helpers and indexed tenant policies', () => {
  const sql = compactSql(migration('0003_rls_canary.sql'));

  assert.match(sql, /current_setting\('app\.tenant_id', true\)/);
  assert.match(sql, /current_setting\('app\.user_id', true\)/);
  assert.match(sql, /create table app_private\.tenant_canary/);
  assert.match(sql, /foreign key \(tenant_id, created_by\) references iam\.memberships \(tenant_id, principal_id\)/);
  assert.match(sql, /create index tenant_canary_tenant_id_id_idx on app_private\.tenant_canary \(tenant_id, id\)/);

  for (const table of ['iam.tenants', 'iam.principals', 'iam.memberships', 'app_private.tenant_canary']) {
    const escaped = table.replace('.', '\\.');
    assert.match(sql, new RegExp(`alter table ${escaped} enable row level security`));
    assert.match(sql, new RegExp(`alter table ${escaped} force row level security`));
  }

  assert.match(sql, /create policy tenant_canary_select on app_private\.tenant_canary for select to nexus_app using/);
  assert.match(sql, /create policy tenant_canary_insert on app_private\.tenant_canary for insert to nexus_app with check/);
  assert.match(sql, /create policy tenant_canary_update on app_private\.tenant_canary for update to nexus_app using .* with check/);
  assert.match(sql, /create policy tenant_canary_delete on app_private\.tenant_canary for delete to nexus_app using/);
  assert.match(sql, /grant select, insert, update, delete on app_private\.tenant_canary to nexus_app/);
  assert.doesNotMatch(sql, /grant all/);
});

test('new PostgreSQL migrations contain no Supabase identity or role dependency', () => {
  const sql = [
    migration('0001_foundation_schemas.sql'),
    migration('0002_iam_tenancy.sql'),
    migration('0003_rls_canary.sql'),
  ].join('\n');

  assert.doesNotMatch(sql, /supabase|auth\.uid|request\.jwt|\bauthenticated\b/i);
});
