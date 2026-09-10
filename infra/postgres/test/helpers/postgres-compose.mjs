import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const composeFile = join(repositoryRoot, 'infra', 'postgres', 'compose.yaml');
const developmentComposeFile = join(
  repositoryRoot,
  'infra',
  'postgres',
  'compose.development.yaml',
);

export function dockerComposeAvailable() {
  return spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
}

export class PostgresComposeHarness {
  constructor({ port = 55439 } = {}) {
    const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
    this.projectName = `ens-postgres-test-${suffix}`;
    this.port = port;
    this.secretDirectory = mkdtempSync(join(tmpdir(), 'ens-postgres-integration-'));
    this.passwords = {
      bootstrap: randomBytes(32).toString('base64url'),
      migrator: randomBytes(32).toString('base64url'),
      app: randomBytes(32).toString('base64url'),
    };

    const secretEnvironment = {};
    for (const [name, password] of Object.entries(this.passwords)) {
      const path = join(this.secretDirectory, `${name}.txt`);
      writeFileSync(path, `${password}\n`, { mode: 0o600 });
      secretEnvironment[`POSTGRES_${name.toUpperCase()}_PASSWORD_FILE`] = path;
    }

    this.environment = {
      ...process.env,
      ...secretEnvironment,
      POSTGRES_DEV_PORT: String(port),
      POSTGRES_DATA_VOLUME_NAME: `${this.projectName}-data`,
      POSTGRES_DATA_NETWORK_NAME: `${this.projectName}-network`,
    };
  }

  compose(arguments_) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        this.projectName,
        '--profile',
        'tools',
        '-f',
        composeFile,
        '-f',
        developmentComposeFile,
        ...arguments_,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: this.environment,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `docker compose ${arguments_.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    return result;
  }

  start() {
    this.compose(['up', '-d', '--wait', 'postgres']);
    this.compose(['run', '--rm', '--no-deps', 'postgres-bootstrap']);
    this.compose(['build', 'postgres-migrate']);
    return this.migrate();
  }

  migrate() {
    return this.compose(['run', '--rm', '--no-deps', 'postgres-migrate']);
  }

  connectionConfig(role) {
    const users = {
      bootstrap: 'nexus_bootstrap',
      migrator: 'nexus_migrator',
      app: 'nexus_app',
    };
    return {
      host: '127.0.0.1',
      port: this.port,
      database: 'nexus',
      user: users[role],
      password: this.passwords[role],
      application_name: `ens-foundation-integration-${role}`,
    };
  }

  cleanup() {
    try {
      this.compose(['down', '--volumes', '--remove-orphans', '--timeout', '5']);
    } finally {
      rmSync(this.secretDirectory, { recursive: true, force: true });
    }
  }
}

