import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { openAdsSecret, sealAdsSecret } from '../../domain/adsCrypto.js';
import { appError } from '../../errors.js';
import { adsProviders, type AdsProvider, type AdsProviderConfig } from './types.js';
import type { Pool } from 'pg';

const fileId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maximumBytes = 64 * 1024;
function storageError() { return appError('ads_setup_storage_unavailable', 503, 'Private Ads configuration storage is unavailable'); }

// PostgreSQL publishes the immutable file ID only after this file is durable.
// Abandoned files have no authority and are pruned under the publication lock.
export class AdsSetupStore {
  readonly key: Buffer;
  constructor(readonly directory: string, externalKey?: Buffer, hasEncryptedReferences = false) {
    try {
      if (!isAbsolute(directory)) throw storageError();
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw storageError();
      chmodSync(directory, 0o700);
      const keyPath = join(directory, 'encryption-key');
      if (!existsSync(keyPath)) {
        if (hasEncryptedReferences && !externalKey) throw storageError();
        if (readdirSync(directory).some(name => name.endsWith('.json'))) throw storageError();
        const candidate = externalKey ?? randomBytes(32);
        if (candidate.length !== 32) throw storageError();
        try { this.privateWrite(keyPath, candidate.toString('hex')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      const encoded = this.privateRead(keyPath).trim();
      if (!/^[a-f0-9]{64}$/.test(encoded)) throw storageError();
      this.key = Buffer.from(encoded, 'hex');
      if (externalKey && (externalKey.length !== 32 || !timingSafeEqual(externalKey, this.key))) throw storageError();
    } catch { throw storageError(); }
  }
  private privateWrite(path: string, value: string): void {
    const descriptor = openSync(path, 'wx', 0o600);
    try { writeFileSync(descriptor, value, 'utf8'); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    this.syncDirectory();
  }
  private syncDirectory(): void {
    // Windows does not support opening a directory for fsync.
    if (process.platform === 'win32') return;
    const descriptor = openSync(this.directory, 'r');
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  private privateRead(path: string): string {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) throw storageError();
    chmodSync(path, 0o600);
    return readFileSync(path, 'utf8');
  }
  private path(file: string): string {
    if (!fileId.test(file)) throw storageError();
    return join(this.directory, `${file}.json`);
  }
  write(provider: AdsProvider, settings: AdsProviderConfig): string {
    try {
      if (!adsProviders.includes(provider) || Buffer.byteLength(JSON.stringify(settings)) > maximumBytes / 2) throw storageError();
      const file = randomUUID(); const temporary = `${this.path(file)}.pending`;
      this.privateWrite(temporary, sealAdsSecret(this.key, `ads-setup:${provider}:${file}`, settings));
      renameSync(temporary, this.path(file)); this.syncDirectory(); return file;
    } catch { throw storageError(); }
  }
  read(provider: AdsProvider, file: string): AdsProviderConfig {
    try { return openAdsSecret<AdsProviderConfig>(this.key, `ads-setup:${provider}:${file}`, this.privateRead(this.path(file))); }
    catch { throw storageError(); }
  }
  prune(retained: string[]): void {
    try {
      const keep = new Set(retained.map(file => `${file}.json`));
      for (const name of readdirSync(this.directory)) {
        if ((fileId.test(name.replace(/\.json(?:\.pending)?$/, ''))) && !keep.has(name)) unlinkSync(join(this.directory, name));
      }
      this.syncDirectory();
    } catch { throw storageError(); }
  }
}

// Startup uses a narrow security-definer predicate because ordinary application
// reads without an actor cannot see encrypted token/publication references.
export async function openAdsSetupStore(pool: Pool, directory: string, externalKey?: Buffer): Promise<AdsSetupStore> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("select pg_advisory_xact_lock(hashtextextended('ads-installation-setup',0))");
    const references = await db.query<{ present: boolean }>('select marketing_ops_private.ads_has_encrypted_references() as present');
    const store = new AdsSetupStore(directory, externalKey, references.rows[0]?.present ?? true);
    await db.query('commit');
    return store;
  } catch {
    await db.query('rollback').catch(() => undefined);
    throw storageError();
  } finally { db.release(); }
}
