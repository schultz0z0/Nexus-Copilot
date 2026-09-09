import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const validator = join(repositoryRoot, 'scripts', 'validate-hermes-distribution.mjs');

function runValidator(distributionDirectory) {
  return spawnSync(process.execPath, [validator, distributionDirectory], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function writeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'ens-hermes-distribution-'));

  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents, 'utf8');
  }

  return root;
}

test('the checked-in ENS distribution satisfies the Hermes contract', () => {
  const result = runValidator(join(repositoryRoot, 'agents', 'ens'));

  assert.equal(
    result.status,
    0,
    `validator failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /ENS profile distribution is valid/);
});

test('the validator reports every contract violation in one run', () => {
  const fixture = writeFixture({
    'distribution.yaml': [
      'name: other',
      'hermes_requires: ">=0.12.0"',
      'env_requires:',
      '  - name: UNUSED_ENV',
      'distribution_owned:',
      '  - distribution.yaml',
      '  - missing.txt',
      '  - auth.json',
      '',
    ].join('\n'),
    'config.yaml': [
      'model: secret-model',
      'provider: external',
      'api_key: hard-coded-secret',
      'mcp_servers:',
      '  nexus_marketing_ops:',
      '    url: "${UNDECLARED_MCP_URL}"',
      '',
    ].join('\n'),
    'mcp.json': JSON.stringify({
      mcpServers: {
        nexus_marketing_ops: { url: '${UNDECLARED_MCP_URL}' },
      },
    }),
    'auth.json': '{}',
  });

  const result = runValidator(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /name must be exactly "ens"/);
  assert.match(result.stderr, /hermes_requires must require at least 0\.20\.6/);
  assert.match(result.stderr, /distribution_owned path does not exist: missing\.txt/);
  assert.match(result.stderr, /forbidden state path: auth\.json/);
  assert.match(result.stderr, /provider or model setting/);
  assert.match(result.stderr, /secret-like setting/);
  assert.match(result.stderr, /_config_version must be exactly 12/);
  assert.match(result.stderr, /nexus_marketing_ops must be defined exactly once/);
  assert.match(result.stderr, /environment variable is not declared: UNDECLARED_MCP_URL/);
});
