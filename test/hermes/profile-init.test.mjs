import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const initializer = join(repositoryRoot, 'infra', 'hermes', 'profile-init.sh');
const shell = findPosixShell();

function findPosixShell() {
  const candidates = [
    process.env.POSIX_SHELL,
    '/bin/sh',
    '/usr/bin/sh',
    'C:\\Program Files\\Git\\bin\\sh.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function createHarness({
  profileExists = false,
  failAction,
  configVersion,
  rootConfigExists = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ens-hermes-profile-init-'));
  const distribution = join(root, 'distribution');
  const hermesHome = join(root, 'hermes-home');
  const profileHome = join(hermesHome, 'profiles', 'ens');
  const fakeHermes = join(root, 'fake-hermes.sh');
  const fakePython = join(root, 'fake-python.sh');
  const fakeMigrator = join(root, 'docker-config-migrate.py');
  const calls = join(root, 'calls.log');
  const state = join(root, 'profile-installed');
  mkdirSync(distribution);
  mkdirSync(profileHome, { recursive: true });
  writeFileSync(join(distribution, 'distribution.yaml'), 'name: ens\n', 'utf8');
  const versionLine = configVersion === undefined ? '' : `_config_version: ${configVersion}\n`;
  if (rootConfigExists) {
    writeFileSync(join(hermesHome, 'config.yaml'), `${versionLine}terminal: {}\n`, 'utf8');
  }
  writeFileSync(join(profileHome, 'config.yaml'), `${versionLine}terminal: {}\n`, 'utf8');
  if (profileExists) writeFileSync(state, '', 'utf8');
  writeFileSync(
    fakeHermes,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$CALLS_LOG"
action="$1 $2"
if [ "$action" = "profile info" ] && [ ! -f "$PROFILE_STATE" ]; then
  exit 1
fi
if [ "\${FAIL_ACTION:-}" = "$action" ]; then
  exit 42
fi
if [ "$action" = "profile install" ] || [ "$action" = "profile update" ]; then
  : > "$PROFILE_STATE"
fi
`,
    'utf8',
  );
  chmodSync(fakeHermes, 0o755);
  writeFileSync(
    fakePython,
    `#!/bin/sh
set -eu
printf 'migrate %s %s\n' "$HERMES_HOME" "$*" >> "$CALLS_LOG"
`,
    'utf8',
  );
  chmodSync(fakePython, 0o755);
  writeFileSync(fakeMigrator, '# test migrator\n', 'utf8');

  const env = {
    ...process.env,
    CALLS_LOG: calls,
    PROFILE_STATE: state,
    HERMES_CLI: fakeHermes,
    HERMES_CONFIG_MIGRATOR: fakeMigrator,
    HERMES_DISTRIBUTION_DIR: distribution,
    HERMES_HOME: hermesHome,
    HERMES_PYTHON: fakePython,
    PATH: `${root}${delimiter}${process.env.PATH ?? ''}`,
  };
  if (failAction) env.FAIL_ACTION = failAction;

  return { calls, env };
}

function execute(harness) {
  return spawnSync(shell, [initializer], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: harness.env,
  });
}

function recordedCalls(harness) {
  return readFileSync(harness.calls, 'utf8').trim().split(/\r?\n/);
}

test('initializer has the safe idempotent command contract', () => {
  const source = readFileSync(initializer, 'utf8');
  assert.match(source, /^#!\/bin\/sh/);
  assert.match(source, /set -eu/);
  assert.match(source, /profile info/);
  assert.match(source, /profile install/);
  assert.match(source, /profile update/);
  assert.match(source, /profile use/);
  assert.match(source, /gateway stop/);
  assert.match(source, /docker_config_migrate/);
  assert.match(source, /if \[ ! -f "\$\{config_path\}" \]/);
  assert.doesNotMatch(source, /--force-config/);
});

test(
  'installs and activates ENS when the profile does not exist',
  { skip: shell ? false : 'POSIX shell is not available on this Windows host' },
  () => {
    const harness = createHarness();
    const result = execute(harness);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(recordedCalls(harness), [
      'profile info ens',
      `profile install ${harness.env.HERMES_DISTRIBUTION_DIR} --name ens --yes`,
      '-p default config set _config_version 12',
      `migrate ${harness.env.HERMES_HOME} ${harness.env.HERMES_CONFIG_MIGRATOR}`,
      '-p ens config set _config_version 12',
      `migrate ${join(harness.env.HERMES_HOME, 'profiles', 'ens')} ${harness.env.HERMES_CONFIG_MIGRATOR}`,
      '-p default gateway stop',
      'profile use ens',
      'profile info ens',
    ]);
  },
);

test(
  'updates and activates ENS when the profile already exists',
  { skip: shell ? false : 'POSIX shell is not available on this Windows host' },
  () => {
    const harness = createHarness({ profileExists: true });
    const result = execute(harness);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(recordedCalls(harness), [
      'profile info ens',
      'profile update ens --yes',
      '-p default config set _config_version 12',
      `migrate ${harness.env.HERMES_HOME} ${harness.env.HERMES_CONFIG_MIGRATOR}`,
      '-p ens config set _config_version 12',
      `migrate ${join(harness.env.HERMES_HOME, 'profiles', 'ens')} ${harness.env.HERMES_CONFIG_MIGRATOR}`,
      '-p default gateway stop',
      'profile use ens',
      'profile info ens',
    ]);
  },
);

test(
  'bootstraps an absent root config on a fresh Hermes volume',
  { skip: shell ? false : 'POSIX shell is not available on this Windows host' },
  () => {
    const harness = createHarness({ rootConfigExists: false });
    const result = execute(harness);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(recordedCalls(harness), [
      'profile info ens',
      `profile install ${harness.env.HERMES_DISTRIBUTION_DIR} --name ens --yes`,
      '-p default config set _config_version 12',
      `migrate ${harness.env.HERMES_HOME} ${harness.env.HERMES_CONFIG_MIGRATOR}`,
      '-p ens config set _config_version 12',
      `migrate ${join(harness.env.HERMES_HOME, 'profiles', 'ens')} ${harness.env.HERMES_CONFIG_MIGRATOR}`,
      '-p default gateway stop',
      'profile use ens',
      'profile info ens',
    ]);
  },
);

test(
  'refuses an explicit config schema below the supported migration floor',
  { skip: shell ? false : 'POSIX shell is not available on this Windows host' },
  () => {
    const harness = createHarness({ profileExists: true, configVersion: 11 });
    const result = execute(harness);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /below the supported floor 12/);
    assert.deepEqual(recordedCalls(harness), [
      'profile info ens',
      'profile update ens --yes',
    ]);
  },
);

test(
  'does not activate ENS after an install failure',
  { skip: shell ? false : 'POSIX shell is not available on this Windows host' },
  () => {
    const harness = createHarness({ failAction: 'profile install' });
    const result = execute(harness);
    assert.notEqual(result.status, 0);
    assert.deepEqual(recordedCalls(harness), [
      'profile info ens',
      `profile install ${harness.env.HERMES_DISTRIBUTION_DIR} --name ens --yes`,
    ]);
  },
);

test(
  'does not activate ENS after an update failure',
  { skip: shell ? false : 'POSIX shell is not available on this Windows host' },
  () => {
    const harness = createHarness({ profileExists: true, failAction: 'profile update' });
    const result = execute(harness);
    assert.notEqual(result.status, 0);
    assert.deepEqual(recordedCalls(harness), [
      'profile info ens',
      'profile update ens --yes',
    ]);
  },
);
