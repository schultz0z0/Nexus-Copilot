import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const composeFile = join(repositoryRoot, 'infra', 'postgres', 'compose.yaml');
const developmentComposeFile = join(
  repositoryRoot,
  'infra',
  'postgres',
  'compose.development.yaml',
);
const productionComposeFile = join(
  repositoryRoot,
  'infra',
  'postgres',
  'compose.production.yaml',
);
const dockerfileOps = join(repositoryRoot, 'infra', 'postgres', 'Dockerfile.ops');
const backupScript = join(repositoryRoot, 'infra', 'postgres', 'ops', 'backup.sh');
const commonScript = join(repositoryRoot, 'infra', 'postgres', 'ops', 'common.sh');
const initRepoScript = join(repositoryRoot, 'infra', 'postgres', 'ops', 'init-repository.sh');

function dockerComposeAvailable() {
  return spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
}

function renderOpsCompose(overrideFile, environment = {}) {
  const secretDirectory = mkdtempSync(join(tmpdir(), 'ens-postgres-ops-contract-'));
  const secretEnvironment = {};

  for (const name of ['bootstrap', 'migrator', 'app', 'backup', 'restic']) {
    const secretPath = join(secretDirectory, `${name}.txt`);
    writeFileSync(secretPath, `contract-test-${name}\n`, { mode: 0o600 });
    secretEnvironment[`POSTGRES_${name.toUpperCase()}_PASSWORD_FILE`] = secretPath;
  }

  try {
    return spawnSync(
      'docker',
      [
        'compose',
        '--profile',
        'ops',
        '-f',
        composeFile,
        '-f',
        overrideFile,
        'config',
        '--format',
        'json',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, ...secretEnvironment, ...environment },
      },
    );
  } finally {
    rmSync(secretDirectory, { recursive: true, force: true });
  }
}

test('operations Dockerfile uses pinned digests and runs as unprivileged user nexus_ops', () => {
  const dockerfile = readFileSync(dockerfileOps, 'utf8');
  assert.match(dockerfile, /FROM restic\/restic:[^@\s]+@sha256:[0-9a-f]{64} AS restic/);
  assert.match(dockerfile, /FROM postgres:18\.6-bookworm@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /^USER nexus_ops$/m);
});

test('backup script enforces custom format, SHA-256 integrity, retention policy and avoids password leaks', () => {
  const backup = readFileSync(backupScript, 'utf8');
  assert.match(backup, /pg_dump .*--format=custom/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /--keep-hourly 48/);
  assert.match(backup, /--keep-daily 14/);
  assert.match(backup, /--keep-weekly 8/);
  assert.doesNotMatch(backup, /set -x|echo .*password/i);
});

test('common ops script exports safe secret reader, atomic status writer and directory checker', () => {
  const common = readFileSync(commonScript, 'utf8');
  assert.match(common, /read_secret\s*\(\s*\)/);
  assert.match(common, /write_status\s*\(\s*\)/);
  assert.match(common, /require_directory\s*\(\s*\)/);
  assert.doesNotMatch(common, /echo .*\$secret/i);
});

test('init-repository script initializes repository only when explicitly requested', () => {
  const init = readFileSync(initRepoScript, 'utf8');
  assert.match(init, /ALLOW_REPOSITORY_INIT/);
  assert.match(init, /restic snapshots/);
  assert.match(init, /restic init/);
});

test(
  'Compose defines hardened postgres-backup service without published ports and with file secrets',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const result = renderOpsCompose(developmentComposeFile);
    assert.equal(result.status, 0, result.stderr);

    const configuration = JSON.parse(result.stdout);
    const service = configuration.services['postgres-backup'];
    assert.ok(service, 'postgres-backup service should exist');
    assert.equal(service.restart, 'no');
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.equal(service.ports, undefined);

    assert.equal(service.environment.PGUSER, 'nexus_backup');
    assert.equal(
      service.environment.PGPASSWORD_FILE,
      '/run/secrets/postgres_backup_password',
    );
    assert.equal(
      service.environment.RESTIC_PASSWORD_FILE,
      '/run/secrets/postgres_restic_password',
    );

    const secretSources = service.secrets.map((secret) => secret.source).sort();
    assert.deepEqual(secretSources, [
      'postgres_backup_password',
      'postgres_restic_password',
    ]);
  },
);
