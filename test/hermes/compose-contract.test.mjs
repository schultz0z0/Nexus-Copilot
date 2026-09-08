import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const composeFile = join(repositoryRoot, 'infra', 'hermes', 'compose.yaml');
const environmentFile = join(repositoryRoot, 'infra', 'hermes', 'hermes.env.example');
const expectedImage =
  'nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79';

function dockerComposeAvailable() {
  const result = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return result.status === 0;
}

function renderCompose() {
  return spawnSync(
    'docker',
    ['compose', '--env-file', environmentFile, '-f', composeFile, 'config', '--format', 'json'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        API_SERVER_KEY: 'contract-test-only-key',
      },
    },
  );
}

function volumeTargets(service) {
  return new Map(
    (service.volumes ?? []).map((volume) => [
      volume.target,
      { source: volume.source, readOnly: volume.read_only === true },
    ]),
  );
}

test('base Compose text pins the approved official image and excludes unsafe mounts', () => {
  const source = readFileSync(composeFile, 'utf8');
  assert.match(source, new RegExp(expectedImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /docker\.sock/);
  assert.doesNotMatch(source, /^\s*ports\s*:/m);
  assert.doesNotMatch(source, /provider|model/i);
});

test(
  'rendered base Compose isolates the API and initializes one persistent profile',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const result = renderCompose();
    assert.equal(
      result.status,
      0,
      `docker compose config failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const configuration = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(configuration.services).sort(), ['hermes', 'hermes-profile-init']);

    const initializer = configuration.services['hermes-profile-init'];
    const runtime = configuration.services.hermes;
    assert.equal(initializer.image, expectedImage);
    assert.equal(runtime.image, expectedImage);
    assert.equal(initializer.restart, 'no');
    assert.equal(runtime.restart, 'unless-stopped');
    assert.equal(runtime.depends_on['hermes-profile-init'].condition, 'service_completed_successfully');

    const initializerVolumes = volumeTargets(initializer);
    const runtimeVolumes = volumeTargets(runtime);
    assert.equal(initializerVolumes.get('/opt/data')?.source, 'hermes-data');
    assert.equal(runtimeVolumes.get('/opt/data')?.source, 'hermes-data');
    assert.deepEqual(initializerVolumes.get('/distribution'), {
      source: resolve(repositoryRoot, 'agents', 'ens'),
      readOnly: true,
    });
    assert.equal(initializerVolumes.get('/profile-init.sh')?.readOnly, true);
    assert.equal(runtimeVolumes.has('/distribution'), false);
    assert.equal(runtimeVolumes.has('/profile-init.sh'), false);

    assert.equal(runtime.environment.HERMES_HOME, '/opt/data');
    assert.equal(runtime.environment.HERMES_PROFILE_NAME, 'ens');
    assert.equal(runtime.environment.API_SERVER_ENABLED, 'true');
    assert.equal(runtime.environment.API_SERVER_HOST, '0.0.0.0');
    assert.equal(runtime.environment.HERMES_DASHBOARD, '1');
    assert.ok(runtime.healthcheck, 'runtime healthcheck must exist');
    assert.equal(runtime.ports, undefined);
    assert.equal(initializer.ports, undefined);
  },
);

test('the example environment file contains no configured provider or credential', () => {
  const source = readFileSync(environmentFile, 'utf8');
  assert.match(source, /^HERMES_PROFILE_NAME=ens$/m);
  assert.match(source, /^API_SERVER_KEY=$/m);
  assert.doesNotMatch(source, /^(?:.*PROVIDER|.*MODEL)=/im);
  assert.doesNotMatch(source, /^(?:.*SECRET|.*TOKEN)=.+/im);
});
