import { describe, it, expect } from 'vitest';
import { WorkspaceSetupSchema, WorkspaceMailSchema, WorkspaceEventSchema, workspacePeriod } from './workspaceContracts.js';
describe('workspace command contracts', () => {
    it('rejects browser-controlled callbacks and invalid recipients', () => {
        expect(() => WorkspaceSetupSchema.parse({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://evil.invalid' })).toThrow();
        expect(() => WorkspaceMailSchema.parse({ to: ['a@example.com\r\nBcc: hidden@example.com'], subject: 'Hi', text: 'Body' })).toThrow();
    });
    it('requires a reviewed event and bounded real dates', () => {
        const event = { title: 'Launch', description: '', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z', timeZone: 'America/Sao_Paulo', confirm: true };
        expect(WorkspaceEventSchema.parse(event).confirm).toBe(true);
        expect(() => WorkspaceEventSchema.parse({ ...event, confirm: false })).toThrow();
        expect(() => workspacePeriod({ from: '2026-02-30', to: '2026-03-01' })).toThrow();
    });
});
