import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalDatabaseUrl,
  assertRehearsalDatabaseName,
  identityMapping
} from '../rehearsal.mjs';

test('local rehearsal accepts loopback PostgreSQL and an isolated database name', () => {
  assert.equal(assertLocalDatabaseUrl('postgresql://postgres:test@127.0.0.1:55323/nexus', 'source').hostname, '127.0.0.1');
  assert.equal(assertRehearsalDatabaseName('nexus_m6_rehearsal_20260913'), 'nexus_m6_rehearsal_20260913');
});

test('local rehearsal rejects remote hosts and broad destination names', () => {
  assert.throws(() => assertLocalDatabaseUrl('postgresql://db.example.test/nexus', 'source'), /loopback/);
  assert.throws(() => assertRehearsalDatabaseName('nexus'), /isolated/);
});

test('identity mapping preserves only canonical tenant and principal ids', () => {
  assert.deepEqual(identityMapping(
    [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    [{ id: '11111111-1111-4111-8111-111111111111' }]
  ), {
    tenants: { 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    principals: { '11111111-1111-4111-8111-111111111111': '11111111-1111-4111-8111-111111111111' }
  });
});
