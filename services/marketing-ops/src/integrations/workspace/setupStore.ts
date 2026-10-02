import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { sealAdsSecret, openAdsSecret } from '../../domain/adsCrypto.js';
import { appError } from '../../errors.js';
import type { WorkspaceAppConfig, WorkspaceFamily } from './types.js';
export class WorkspaceSetupStore {
    constructor(private directory: string, readonly key: Buffer) {
        try {
            if (!isAbsolute(directory) || key.length !== 32)
                throw new Error();
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
                throw new Error();
            chmodSync(directory, 0o700);
        }
        catch {
            throw appError('workspace_storage_unavailable', 503, 'Private installation storage is unavailable');
        }
    }
    private path(id: string) {
        if (!/^[a-f0-9-]{36}$/.test(id))
            throw appError('workspace_storage_unavailable', 503, 'Private installation storage is unavailable');
        return join(this.directory, `${id}.json`);
    }
    write(family: WorkspaceFamily, config: WorkspaceAppConfig) {
        const id = randomUUID();
        const pending = this.path(id) + '.pending';
        const fd = openSync(pending, 'wx', 0o600);
        try {
            writeFileSync(fd, sealAdsSecret(this.key, `workspace-setup:${family}:${id}`, config), 'utf8');
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(pending, this.path(id));
        if (process.platform !== 'win32') {
            const dir = openSync(this.directory, 'r');
            try {
                fsyncSync(dir);
            }
            finally {
                closeSync(dir);
            }
        }
        return id;
    }
    read(family: WorkspaceFamily, id: string): WorkspaceAppConfig {
        try {
            const path = this.path(id);
            const info = lstatSync(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 40000)
                throw new Error();
            chmodSync(path, 0o600);
            return openAdsSecret(this.key, `workspace-setup:${family}:${id}`, readFileSync(path, 'utf8'));
        }
        catch {
            throw appError('workspace_storage_unavailable', 503, 'Private installation storage is unavailable');
        }
    }
}
