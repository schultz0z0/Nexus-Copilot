import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdsSetupStore } from './setupStore.js';

const directories: string[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), 'ads-setup-')); directories.push(path); return path; }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const settings = { clientId: 'application', clientSecret: 'private-client-secret', redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'] };

describe('private Ads setup storage', () => {
  it('persists an automatically provisioned key and encrypted configuration across restart', () => {
    const path = directory(); const store = new AdsSetupStore(path);
    const file = store.write('google', settings);
    expect(store.key.length).toBe(32);
    const restart = new AdsSetupStore(path);
    expect(restart.key.equals(store.key)).toBe(true);
    expect(restart.read('google', file)).toEqual(settings);
    expect(readFileSync(join(path, `${file}.json`), 'utf8')).not.toContain(settings.clientSecret);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o700);
      expect(statSync(join(path, `${file}.json`)).mode & 0o777).toBe(0o600);
    }
  });
  it('uses an operational key and refuses silent rotation or a missing key with existing files', () => {
    const path = directory(); const key = Buffer.alloc(32, 7); const store = new AdsSetupStore(path, key);
    expect(store.key.equals(key)).toBe(true); store.write('google', settings);
    expect(() => new AdsSetupStore(path, Buffer.alloc(32, 8))).toThrow();
    rmSync(join(path, 'encryption-key'));
    expect(() => new AdsSetupStore(path)).toThrow();
  });
  it('rejects path traversal, oversized settings and tampered credentials without returning unsafe content', () => {
    const store = new AdsSetupStore(directory());
    expect(() => store.read('google', '../secret')).toThrow();
    expect(() => store.write('google', { ...settings, clientSecret: 'x'.repeat(100000) })).toThrow();
    const file = store.write('google', settings);
    writeFileSync(join(store.directory, `${file}.json`), '{}');
    expect(() => store.read('google', file)).toThrow();
  });
  it('retains referenced files and removes abandoned candidates before another publication', () => {
    const store = new AdsSetupStore(directory()); const current = store.write('google', settings);
    const orphan = store.write('google', { ...settings, clientId: 'abandoned' });
    store.prune([current]);
    expect(readdirSync(store.directory)).toContain(`${current}.json`);
    expect(readdirSync(store.directory)).not.toContain(`${orphan}.json`);
  });
  it('refuses to provision a missing installation key when the database still references encrypted data', () => {
    const path = directory();
    expect(() => new AdsSetupStore(path, undefined, true)).toThrow();
    expect(readdirSync(path)).not.toContain('encryption-key');
    const key = Buffer.alloc(32, 7);
    expect(new AdsSetupStore(path, key, true).key.equals(key)).toBe(true);
  });
});
