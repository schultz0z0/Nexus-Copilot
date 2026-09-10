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
  assert.match(sql, /grant create on database :"database_name" to nexus_owner/);
});

test('bootstrap obtains passwords from process environment without embedding or echoing them', () => {
  const sql = readFileSync(rolesFile, 'utf8');
  const script = readFileSync(bootstrapScript, 'utf8');

  assert.match(sql, /\\getenv nexus_migrator_password NEXUS_MIGRATOR_PASSWORD/);
  assert.match(sql, /\\getenv nexus_app_password NEXUS_APP_PASSWORD/);
  assert.doesNotMatch(sql, /PASSWORD\s+'[^']+'/i);

  assert.match(script, /^set -eu$/m);
  assert.match(script, /\/run\/secrets\/postgres_bootstrap_password/);
  assert.match(script, /\/run\/secrets\/postgres_migrator_password/);
  assert.match(script, /\/run\/secrets\/postgres_app_password/);
  assert.match(script, /^exec psql -X --set ON_ERROR_STOP=1 /m);
  assert.doesNotMatch(script, /echo|set -x|-v\s+\w*password/i);
});

