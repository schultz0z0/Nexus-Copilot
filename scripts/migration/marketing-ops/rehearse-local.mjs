#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { main as migrate } from '../../../infra/postgres/src/migrate.mjs';
import { extract } from './extract.mjs';
import { transform } from './transform.mjs';
import { load } from './load.mjs';
import { reconcile } from './reconcile.mjs';
import { assertLocalDatabaseUrl, assertRehearsalDatabaseName, identityMapping } from './rehearsal.mjs';

const sourceValue = process.env.MARKETING_OPS_REHEARSAL_SOURCE_URL;
const adminValue = process.env.MARKETING_OPS_REHEARSAL_ADMIN_URL ?? sourceValue;
if (!sourceValue) throw new Error('MARKETING_OPS_REHEARSAL_SOURCE_URL is required');
if (process.env.MARKETING_OPS_REHEARSAL_ALLOW_DATABASE_CREATE_DROP !== 'true') {
  throw new Error('MARKETING_OPS_REHEARSAL_ALLOW_DATABASE_CREATE_DROP=true is required');
}

const sourceUrl = assertLocalDatabaseUrl(sourceValue, 'source');
const adminUrl = assertLocalDatabaseUrl(adminValue, 'admin');
const destinationName = assertRehearsalDatabaseName(
  process.env.MARKETING_OPS_REHEARSAL_DATABASE
    ?? `nexus_m6_rehearsal_${Date.now()}_${randomBytes(4).toString('hex')}`
);
if (sourceUrl.pathname.slice(1) === destinationName) throw new Error('source and destination databases must differ');

const destinationUrl = new URL(sourceUrl);
destinationUrl.pathname = `/${destinationName}`;
const sourcePool = new pg.Pool({ connectionString: sourceUrl.toString(), max: 2, application_name: 'ens-m6-rehearsal-source' });
const adminPool = new pg.Pool({ connectionString: adminUrl.toString(), max: 1, application_name: 'ens-m6-rehearsal-admin' });
let destinationPool;
let created = false;
let tempDirectory;
const startedAt = performance.now();

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

async function copyIamRows(destination) {
  const tables = ['tenants', 'principals', 'memberships'];
  const snapshots = {};
  for (const table of tables) {
    snapshots[table] = (await sourcePool.query(
      `select to_jsonb(source) as row from iam.${quoteIdentifier(table)} source order by to_jsonb(source)::text`
    )).rows.map(({ row }) => row);
  }

  const client = await destination.connect();
  try {
    await client.query('begin');
    await client.query('set local role nexus_owner');
    for (const table of tables) {
      for (const row of snapshots[table]) {
        const columns = Object.keys(row);
        await client.query(
          `insert into iam.${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')}) on conflict do nothing`,
          columns.map((column) => row[column])
        );
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return snapshots;
}

try {
  const existing = await adminPool.query('select 1 from pg_database where datname = $1', [destinationName]);
  if (existing.rowCount) throw new Error('isolated destination database already exists');
  await adminPool.query(`create database ${quoteIdentifier(destinationName)} owner nexus_owner`);
  created = true;
  await migrate({ environment: { DATABASE_URL: destinationUrl.toString() } });
  destinationPool = new pg.Pool({ connectionString: destinationUrl.toString(), max: 2, application_name: 'ens-m6-rehearsal-destination' });

  const identities = await copyIamRows(destinationPool);
  tempDirectory = await mkdtemp(join(tmpdir(), 'ens-m6-rehearsal-'));
  const extractedDirectory = join(tempDirectory, 'extracted');
  const transformedDirectory = join(tempDirectory, 'transformed');
  const sourceManifest = await extract({ pool: sourcePool, outputDirectory: extractedDirectory });
  const transformed = await transform({
    inputDirectory: extractedDirectory,
    outputDirectory: transformedDirectory,
    mapping: identityMapping(identities.tenants, identities.principals)
  });
  const firstLoad = await load({ pool: destinationPool, inputDirectory: transformedDirectory });
  const firstReconciliation = await reconcile({ pool: destinationPool, inputDirectory: transformedDirectory });
  const secondLoad = await load({ pool: destinationPool, inputDirectory: transformedDirectory });
  const secondReconciliation = await reconcile({ pool: destinationPool, inputDirectory: transformedDirectory });

  if (firstLoad.status !== 'completed' || secondLoad.status !== 'skipped') {
    throw new Error('migration load did not prove first-run completion and second-run idempotency');
  }
  if (!firstReconciliation.passed || !secondReconciliation.passed) {
    throw new Error('migration reconciliation failed');
  }

  console.log(JSON.stringify({
    event: 'marketing_ops_local_rehearsal_complete',
    durationMs: Math.round(performance.now() - startedAt),
    sourceFingerprint: sourceManifest.fingerprint,
    transformedFingerprint: transformed.manifest.fingerprint,
    quarantined: transformed.quarantine.length,
    acceptedRows: Object.values(firstLoad.counts).reduce((total, count) => total + count, 0),
    firstLoad: firstLoad.status,
    secondLoad: secondLoad.status,
    reconciliationsPassed: 2
  }));
} finally {
  await destinationPool?.end().catch(() => undefined);
  await sourcePool.end().catch(() => undefined);
  if (created) {
    await adminPool.query(`drop database ${quoteIdentifier(destinationName)} with (force)`);
    console.log(JSON.stringify({ event: 'marketing_ops_local_rehearsal_rollback_complete', databaseDropped: true }));
  }
  await adminPool.end().catch(() => undefined);
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}
