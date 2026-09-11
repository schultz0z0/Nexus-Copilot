import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    this.backupDirectory = mkdtempSync(join(tmpdir(), 'ens-postgres-backup-'));
    mkdirSync(join(this.backupDirectory, 'status'), { recursive: true });
    mkdirSync(join(this.backupDirectory, 'restic'), { recursive: true });
    this.passwords = {
      bootstrap: randomBytes(32).toString('base64url'),
      migrator: randomBytes(32).toString('base64url'),
      app: randomBytes(32).toString('base64url'),
      backup: randomBytes(32).toString('base64url'),
      restic: randomBytes(32).toString('base64url'),
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
      POSTGRES_BACKUP_VOLUME_NAME: `${this.projectName}-backup`,
      POSTGRES_BACKUP_ROOT: this.backupDirectory,
      POSTGRES_RESTORE_DATA_VOLUME_NAME: `${this.projectName}-restore-data`,
    };
  }

  compose(arguments_, options = {}) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        this.projectName,
        '--profile',
        'tools',
        '--profile',
        'ops',
        '-f',
        composeFile,
        '-f',
        developmentComposeFile,
        ...arguments_,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...this.environment, ...(options.env || {}) },
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (!options.allowFailure && result.status !== 0) {
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
    this.compose(['build', 'postgres-backup']);
    this.compose(['build', 'postgres-observe']);
    return this.migrate();
  }

  migrate() {
    return this.compose(['run', '--rm', '--no-deps', 'postgres-migrate']);
  }

  initializeBackupRepository() {
    return this.compose(
      [
        'run',
        '--rm',
        '--no-deps',
        '-e',
        'ALLOW_REPOSITORY_INIT=1',
        '--entrypoint',
        '/bin/sh',
        'postgres-backup',
        '/opt/nexus-postgres/ops/init-repository.sh',
      ],
      { allowFailure: true },
    );
  }

  backup() {
    return this.compose(['run', '--rm', '--no-deps', 'postgres-backup'], { allowFailure: true });
  }

  restic(args, passwordFile) {
    const runArgs = [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'restic',
    ];
    if (passwordFile) {
      runArgs.push(
        '-v',
        `${resolve(passwordFile)}:/tmp/custom_restic_password:ro`,
        '-e',
        'RESTIC_PASSWORD_FILE=/tmp/custom_restic_password',
      );
    }
    runArgs.push('postgres-backup', ...args);
    return this.compose(runArgs, { allowFailure: true });
  }

  get backupStatusPath() {
    return join(this.backupDirectory, 'status', 'last-backup.json');
  }

  restoreDrill() {
    this.compose(['up', '-d', '--wait', 'postgres-restore']);
    this.compose(['run', '--rm', '--no-deps', 'postgres-restore-bootstrap']);
    return this.compose(['run', '--rm', '--no-deps', 'postgres-restore-drill'], { allowFailure: true });
  }

  get restoreDrillStatusPath() {
    return join(this.backupDirectory, 'status', 'last-restore-drill.json');
  }

  queryRestoredDatabase(sql) {
    const result = this.compose(
      [
        'exec',
        '-T',
        '-e',
        `PGPASSWORD=${this.passwords.bootstrap}`,
        'postgres-restore',
        'psql',
        '-U',
        'nexus_bootstrap',
        '-d',
        'nexus',
        '-At',
        '-c',
        sql,
      ],
      { allowFailure: false },
    );
    return result.stdout.trim();
  }

  observe() {
    return this.compose(['run', '--rm', '--no-deps', '-T', 'postgres-observe'], { allowFailure: true });
  }

  connectionConfig(role) {
    const users = {
      bootstrap: 'nexus_bootstrap',
      migrator: 'nexus_migrator',
      app: 'nexus_app',
      backup: 'nexus_backup',
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
      this.compose(['down', '--volumes', '--remove-orphans', '--timeout', '5'], { allowFailure: true });
    } finally {
      if (this.secretDirectory && resolve(this.secretDirectory).startsWith(resolve(tmpdir()))) {
        rmSync(this.secretDirectory, { recursive: true, force: true });
      }
      if (this.backupDirectory && resolve(this.backupDirectory).startsWith(resolve(tmpdir()))) {
        rmSync(this.backupDirectory, { recursive: true, force: true });
      }
    }
  }
}

