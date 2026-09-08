import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const smokeScript = join(repositoryRoot, 'scripts', 'smoke-hermes-runtime.mjs');
const apiKey = 'smoke-test-super-secret-key';
const requiredFeatures = {
  run_submission: true,
  run_status: true,
  run_events_sse: true,
  run_stop: true,
  run_approval: true,
};

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function runSmoke(baseUrl, extraArguments = [], environment = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [
        smokeScript,
        '--base-url',
        baseUrl,
        '--api-key-env',
        'SMOKE_HERMES_API_KEY',
        '--timeout-ms',
        '250',
        ...extraArguments,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, SMOKE_HERMES_API_KEY: apiKey, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

test('smoke checks liveness, authenticated readiness, and required capabilities', async () => {
  const requests = [];
  const result = await withServer(
    (request, response) => {
      requests.push({ path: request.url, authorization: request.headers.authorization });
      if (request.url === '/health') return json(response, 200, { status: 'ok' });
      if (request.url === '/health/detailed') {
        return json(response, 200, {
          status: 'degraded',
          readiness: { checks: { provider: { status: 'provider_unconfigured' } } },
        });
      }
      if (request.url === '/v1/capabilities') {
        return json(response, 200, {
          auth: { type: 'bearer', required: true },
          features: requiredFeatures,
        });
      }
      return json(response, 404, { error: 'not found' });
    },
    (baseUrl) => runSmoke(baseUrl, ['--allow-provider-unconfigured']),
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PASS liveness/);
  assert.match(result.stdout, /DEGRADED readiness: provider_unconfigured \(allowed\)/);
  assert.match(result.stdout, /PASS capabilities/);
  assert.deepEqual(requests, [
    { path: '/health', authorization: undefined },
    { path: '/health/detailed', authorization: `Bearer ${apiKey}` },
    { path: '/v1/capabilities', authorization: `Bearer ${apiKey}` },
  ]);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(apiKey, 'g'));
});

test('provider_unconfigured fails unless explicitly allowed', async () => {
  const result = await withServer((request, response) => {
    if (request.url === '/health') return json(response, 200, { status: 'ok' });
    return json(response, 200, {
      status: 'degraded',
      readiness: { checks: [{ code: 'provider_unconfigured' }] },
    });
  }, (baseUrl) => runSmoke(baseUrl));

  assert.equal(result.code, 1);
  assert.match(result.stderr, /readiness is degraded: provider_unconfigured/);
});

test('authentication failures are distinct and never reveal the API key', async () => {
  const result = await withServer((request, response) => {
    if (request.url === '/health') return json(response, 200, { status: 'ok' });
    return json(response, 401, { error: 'unauthorized' });
  }, (baseUrl) => runSmoke(baseUrl));

  assert.equal(result.code, 1);
  assert.match(result.stderr, /authentication failed for \/health\/detailed \(HTTP 401\)/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(apiKey, 'g'));
});

test('invalid JSON has a distinct failure message', async () => {
  const result = await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{invalid');
  }, (baseUrl) => runSmoke(baseUrl));

  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid JSON from \/health/);
});

test('request timeout has a distinct failure message', async () => {
  const result = await withServer((_request, _response) => {}, (baseUrl) =>
    runSmoke(baseUrl, ['--timeout-ms', '30']),
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /request timed out for \/health after 30ms/);
});

test('missing required capability fails closed', async () => {
  const result = await withServer((request, response) => {
    if (request.url === '/health') return json(response, 200, { status: 'ok' });
    if (request.url === '/health/detailed') return json(response, 200, { status: 'ok' });
    return json(response, 200, {
      auth: { type: 'bearer', required: true },
      features: { ...requiredFeatures, run_stop: false },
    });
  }, (baseUrl) => runSmoke(baseUrl));

  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing required capabilities: run_stop/);
});
