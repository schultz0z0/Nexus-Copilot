import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { WorkspaceSetupStore } from './setupStore.js';
describe('private workspace installation storage', () => {
    it('encrypts app secrets in a separate namespace with authenticated family and persistent key', () => {
        const dir = mkdtempSync(join(tmpdir(), 'workspace-secret-'));
        try {
            const store = new WorkspaceSetupStore(dir, Buffer.alloc(32, 8));
            const value = { clientId: 'client', clientSecret: 'private-secret', redirectUri: 'http://127.0.0.1:8088/api/workspace/oauth/google/callback' };
            const id = store.write('google', value);
            expect(readFileSync(join(dir, `${id}.json`), 'utf8')).not.toContain('private-secret');
            expect(new WorkspaceSetupStore(dir, Buffer.alloc(32, 8)).read('google', id)).toEqual(value);
            expect(() => store.read('microsoft', id)).toThrow();
            expect(() => new WorkspaceSetupStore(dir, Buffer.alloc(32, 9)).read('google', id)).toThrow();
            expect(readdirSync(dir)).toEqual([`${id}.json`]);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it('fails closed rather than creating or regenerating installation keys', () => {
        expect(() => new WorkspaceSetupStore('relative', Buffer.alloc(32))).toThrow();
        const dir = mkdtempSync(join(tmpdir(), 'workspace-key-'));
        try {
            expect(() => new WorkspaceSetupStore(dir, Buffer.alloc(16))).toThrow();
            expect(readdirSync(dir)).toEqual([]);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
