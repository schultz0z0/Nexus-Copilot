#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { extract } from './extract.mjs';
import { transform } from './transform.mjs';
import { load } from './load.mjs';
import { reconcile } from './reconcile.mjs';

const [command, ...argumentsList] = process.argv.slice(2);
const option = (name) => {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
};
const required = (name) => option(name) ?? (() => { throw new Error(`${name} is required`); })();

async function main() {
  if (command === 'transform') {
    const mapping = JSON.parse(await readFile(required('--mapping'), 'utf8'));
    const result = await transform({ inputDirectory: required('--input'), outputDirectory: required('--output'), mapping });
    console.log(JSON.stringify({ status: 'completed', fingerprint: result.manifest.fingerprint,
      quarantined: result.quarantine.length }));
    return;
  }
  const connectionString = process.env.MARKETING_OPS_MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error('MARKETING_OPS_MIGRATION_DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString, max: 2, application_name: 'ens-marketing-ops-migration' });
  try {
    if (command === 'extract') console.log(JSON.stringify(await extract({ pool, outputDirectory: required('--output') })));
    else if (command === 'load') console.log(JSON.stringify(await load({ pool, inputDirectory: required('--input'), allowNewRun: argumentsList.includes('--new-run') })));
    else if (command === 'reconcile') console.log(JSON.stringify(await reconcile({ pool, inputDirectory: required('--input'), outputFile: option('--output') })));
    else throw new Error('command must be extract, transform, load or reconcile');
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(`marketing-ops migration failed: ${error.message}`); process.exitCode = 1; });
