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
const migratorDockerfile = join(repositoryRoot, 'infra', 'postgres', 'Dockerfile.migrator');

function dockerComposeAvailable() {
  return spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
}

function renderCompose(overrideFile, environment = {}) {
  const secretDirectory = mkdtempSync(join(tmpdir(), 'ens-postgres-contract-'));
  const secretEnvironment = {};

  for (const name of ['bootstrap', 'migrator', 'app']) {
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
        'tools',
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

function volumeByTarget(service, target) {
  return (service.volumes ?? []).find((volume) => volume.target === target);
}

test('base Compose pins PostgreSQL 18.6 by digest and keeps the database private', () => {
  const source = readFileSync(composeFile, 'utf8');
  assert.match(source, /postgres:18\.6-bookworm@sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(source, /^\s*ports\s*:/m);
  assert.match(source, /POSTGRES_PASSWORD_FILE:\s*\/run\/secrets\/postgres_bootstrap_password/);
  assert.doesNotMatch(source, /POSTGRES_PASSWORD:\s*[^$\s]/);
});

test('migration image is reproducible, minimal and runs as the non-root node user', () => {
  const source = readFileSync(migratorDockerfile, 'utf8');
  assert.match(source, /^FROM node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m);
  assert.match(source, /^RUN npm ci --omit=dev$/m);
  assert.match(source, /^USER node$/m);
  assert.match(source, /^ENTRYPOINT \["node", "src\/migrate\.mjs"\]$/m);
  assert.doesNotMatch(source, /curl|wget|sudo|apt-get/);
});

test(
  'development publishes only PostgreSQL on loopback and defines one-shot jobs',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const result = renderCompose(developmentComposeFile);
    assert.equal(result.status, 0, result.stderr);

    const configuration = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(configuration.services).sort(), [
      'postgres',
      'postgres-bootstrap',
      'postgres-migrate',
    ]);

    const database = configuration.services.postgres;
    assert.deepEqual(database.ports, [
      {
        name: 'postgres-dev',
        mode: 'ingress',
        target: 5432,
        published: '55432',
        protocol: 'tcp',
        host_ip: '127.0.0.1',
      },
    ]);
    assert.ok(database.healthcheck);
    assert.equal(database.environment.POSTGRES_USER, 'nexus_bootstrap');
    assert.equal(database.environment.POSTGRES_DB, 'nexus');
    assert.equal(database.environment.POSTGRES_PASSWORD_FILE, '/run/secrets/postgres_bootstrap_password');
    assert.equal(volumeByTarget(database, '/var/lib/postgresql')?.source, 'postgres-data');

    assert.equal(configuration.services['postgres-bootstrap'].restart, 'no');
    assert.equal(configuration.services['postgres-bootstrap'].user, 'postgres');
    assert.equal(configuration.services['postgres-bootstrap'].read_only, true);
    const migrator = configuration.services['postgres-migrate'];
    assert.equal(migrator.restart, 'no');
    assert.equal(migrator.environment.PGUSER, 'nexus_migrator');
    assert.equal(
      migrator.environment.PGPASSWORD_FILE,
      '/run/secrets/postgres_migrator_password',
    );
    assert.equal(migrator.environment.PGPASSWORD, undefined);
    assert.equal(migrator.command ?? undefined, undefined);
    assert.deepEqual(migrator.secrets, [
      {
        source: 'postgres_migrator_password',
        target: '/run/secrets/postgres_migrator_password',
      },
    ]);
  },
);

test(
  'development port can be isolated per test run',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const result = renderCompose(developmentComposeFile, { POSTGRES_DEV_PORT: '55439' });
    assert.equal(result.status, 0, result.stderr);
    const configuration = JSON.parse(result.stdout);
    assert.equal(configuration.services.postgres.ports[0].published, '55439');
  },
);

test(
  'production publishes no database port and uses an internal data network',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const result = renderCompose(productionComposeFile);
    assert.equal(result.status, 0, result.stderr);

    const configuration = JSON.parse(result.stdout);
    for (const service of Object.values(configuration.services)) {
      assert.equal(service.ports, undefined);
    }
    assert.equal(configuration.networks['postgres-data'].internal, true);
    assert.equal(configuration.services.postgres.networks['postgres-data'], null);
  },
);
