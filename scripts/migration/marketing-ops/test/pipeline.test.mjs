import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestFingerprint, rowsJsonl, sha256 } from '../core.mjs';
import { transformRow } from '../transform.mjs';
import { decideRun } from '../load.mjs';

test('canonical JSONL and manifest fingerprints are deterministic', () => {
  const left = rowsJsonl([{ id: 'b', name: 'B' }, { name: 'A', id: 'a' }]);
  const right = rowsJsonl([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  assert.equal(left, right);
  const tables = [{ name: 'campaigns', row_count: 2, sha256: sha256(left) }];
  assert.equal(manifestFingerprint(tables), manifestFingerprint([...tables]));
});

test('same manifest is a no-op and a divergent fingerprint requires an explicit new run', () => {
  const completed = [{ id: 'run-one', manifest_fingerprint: 'a'.repeat(64) }];
  assert.deepEqual(decideRun(completed, 'a'.repeat(64), false), { action: 'skip', runId: 'run-one' });
  assert.throws(() => decideRun(completed, 'b'.repeat(64), false), /--new-run/);
  assert.deepEqual(decideRun(completed, 'b'.repeat(64), true), { action: 'load' });
});

test('transform maps tenant and principal identities to canonical IAM', () => {
  const result = transformRow('campaigns', {
    id: '10000000-0000-4000-8000-000000000001', tenant_id: 'legacy-tenant',
    created_by: 'legacy-user', updated_by: 'legacy-user'
  }, { tenants: { 'legacy-tenant': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    principals: { 'legacy-user': '11111111-1111-4111-8111-111111111111' } });
  assert.deepEqual(result.row, {
    id: '10000000-0000-4000-8000-000000000001', tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    created_by: '11111111-1111-4111-8111-111111111111', updated_by: '11111111-1111-4111-8111-111111111111'
  });
});

test('transform quarantines unmapped identities, missing artifacts and expired delegations', () => {
  const mapping = { tenants: { legacy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, principals: {} };
  assert.match(transformRow('campaigns', { tenant_id: 'missing' }, mapping).quarantine, /tenant/);
  assert.match(transformRow('campaign_materials', { tenant_id: 'legacy' }, mapping).quarantine, /artifact/);
  assert.match(transformRow('delegation_uses', { tenant_id: 'legacy', expires_at: '2020-01-01T00:00:00Z' }, mapping,
    new Date('2026-01-01T00:00:00Z')).quarantine, /expired/);
});
