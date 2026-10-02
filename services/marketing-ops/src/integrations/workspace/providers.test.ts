import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceProviderClient, workspaceScopes } from './providers.js';
import type { WorkspaceService, WorkspaceTokens } from './types.js';
const config = { clientId: 'client', clientSecret: 'private', redirectUri: 'http://localhost/callback', tenantId: 'organizations' };
const tokens = (service: WorkspaceService): WorkspaceTokens => ({ accessToken: 'access', refreshToken: 'refresh', scopes: workspaceScopes(service) });
function transport(...responses: (object | Response)[]) {
    return vi.fn(async () => { const data = responses.shift(); if (!data)
        throw new Error('Unexpected request'); return data instanceof Response ? data : Response.json(data); }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const event = { title: 'Launch', description: 'Campaign', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z', timeZone: 'America/Sao_Paulo', externalKey: 'campaign/action/123' };
const googleEvent = { id: 'e', summary: 'Launch', start: { dateTime: event.start }, end: { dateTime: event.end }, htmlLink: 'https://calendar.google.com/calendar/event?eid=e' };
const graphEvent = { id: 'e', subject: 'Launch', start: { dateTime: '2026-10-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-01T11:00:00', timeZone: 'UTC' }, webLink: 'https://outlook.office.com/calendar/item/e' };
describe('workspace provider transport and OAuth', () => {
    it.each(['google_drive', 'google_gmail', 'google_calendar', 'google_sheets', 'google_search_console', 'microsoft_files', 'microsoft_mail', 'microsoft_calendar'] as WorkspaceService[])('requests independent scopes with PKCE for %s', service => {
        const url = new URL(createWorkspaceProviderClient(service, config).authorizationUrl('opaque', 'verifier'));
        expect(url.searchParams.get('state')).toBe('opaque');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')!.split(' ')).toEqual(workspaceScopes(service));
        expect(url.searchParams.has('client_secret')).toBe(false);
    });
    it('exchanges Google code and preserves original refresh token on renewal', async () => {
        const fetcher = transport({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: workspaceScopes('google_drive').join(' ') }, { access_token: 'b', expires_in: 3600 });
        const client = createWorkspaceProviderClient('google_drive', config, fetcher);
        const initial = await client.exchange('code', 'verifier');
        const renewed = await client.refresh({ ...initial, expiresAt: '2000-01-01T00:00:00Z' });
        expect(renewed.refreshToken).toBe('r');
        expect(new URLSearchParams(fetcher.mock.calls[0]![1].body).get('code_verifier')).toBe('verifier');
    });
    it('Microsoft refresh persists rotating refresh tokens and validates granted capability scopes', async () => {
        const fetcher = transport({ access_token: 'a', refresh_token: 'rotated', expires_in: 3600, scope: 'User.Read Mail.ReadWrite Mail.Send' });
        const renewed = await createWorkspaceProviderClient('microsoft_mail', config, fetcher).refresh(tokens('microsoft_mail'));
        expect(renewed.refreshToken).toBe('rotated');
        const denied = createWorkspaceProviderClient('google_sheets', config, transport({ access_token: 'a', expires_in: 3600, scope: 'openid email profile' }));
        await expect(denied.exchange('c', 'v')).rejects.toMatchObject({ code: 'workspace_permission_required' });
    });
    it('validates Google and Microsoft user identities', async () => {
        expect(await createWorkspaceProviderClient('google_drive', config, transport({ sub: 'u', email: 'a@company.test', name: 'User' })).identity(tokens('google_drive'))).toEqual({ id: 'u', email: 'a@company.test', name: 'User' });
        expect(await createWorkspaceProviderClient('microsoft_files', config, transport({ id: 'u', mail: null, userPrincipalName: 'a@company.test', displayName: 'User' })).identity(tokens('microsoft_files'))).toEqual({ id: 'u', email: 'a@company.test', name: 'User' });
    });
    it.each([[401, 'workspace_reconnect_required'], [403, 'workspace_permission_required'], [429, 'workspace_rate_limited'], [500, 'workspace_provider_unavailable']] as const)('maps %i to safe protocol errors', async (status, code) => {
        const client = createWorkspaceProviderClient('google_drive', config, transport(new Response('secret provider payload', { status })));
        await expect(client.identity(tokens('google_drive'))).rejects.toMatchObject({ code });
        try {
            await createWorkspaceProviderClient('google_drive', config, transport(new Response('secret', { status }))).identity(tokens('google_drive'));
        }
        catch (error) {
            expect(String(error)).not.toContain('secret');
        }
    });
    it('rejects oversized and malformed successful payloads without exposing provider content', async () => {
        await expect(createWorkspaceProviderClient('google_drive', config, transport(new Response('x'.repeat(2000001)))).identity(tokens('google_drive'))).rejects.toMatchObject({ code: 'workspace_invalid_response' });
        await expect(createWorkspaceProviderClient('google_drive', config, transport({ sub: 'u', email: {} })).identity(tokens('google_drive'))).rejects.toMatchObject({ code: 'workspace_invalid_response' });
    });
    it('exchanges Microsoft authorization code on configured organization with PKCE verifier', async () => {
        const fetcher = transport({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'User.Read Calendars.ReadWrite' });
        await createWorkspaceProviderClient('microsoft_calendar', config, fetcher).exchange('code', 'verifier');
        expect(String(fetcher.mock.calls[0]![0])).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
        expect(new URLSearchParams(fetcher.mock.calls[0]![1].body).get('code_verifier')).toBe('verifier');
    });
    it('maps expired OAuth grants and disabled API responses without returning provider metadata', async () => {
        await expect(createWorkspaceProviderClient('google_drive', config, transport(Response.json({ error: 'invalid_grant', error_description: 'private' }, { status: 400 }))).refresh(tokens('google_drive'))).rejects.toMatchObject({ code: 'workspace_reconnect_required' });
        await expect(createWorkspaceProviderClient('google_drive', config, transport(Response.json({ error: { details: [{ reason: 'SERVICE_DISABLED', metadata: { consumer: 'private' } }] } }, { status: 403 }))).resources(tokens('google_drive'))).rejects.toMatchObject({ code: 'workspace_api_disabled' });
    });
    it('does not refresh unexpired tokens and never returns raw network errors', async () => {
        const fetcher = vi.fn(async () => { throw new Error('private token URL'); }) as unknown as typeof fetch;
        const existing = { ...tokens('google_drive'), expiresAt: new Date(Date.now() + 3600000).toISOString() };
        const client = createWorkspaceProviderClient('google_drive', config, fetcher);
        expect(await client.refresh(existing)).toBe(existing);
        await expect(client.identity(existing)).rejects.toMatchObject({ code: 'workspace_provider_unavailable', message: 'Workspace provider is unavailable' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
describe('native workspace operations', () => {
    it('offers the entire Sheets library while keeping spreadsheet discovery separate from Drive folders', async () => {
        const fetcher = transport({ files: [{ id: 'sheet1', name: 'Leads', mimeType: 'application/vnd.google-apps.spreadsheet' }] }, { id: 'real-root', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder' });
        const client = createWorkspaceProviderClient('google_sheets', config, fetcher);
        const page = await client.resources(tokens('google_sheets'));
        expect(page.items.map(item => item.id)).toEqual(['root', 'sheet1']);
        expect(page.items[0]).toMatchObject({ name: 'Todas as planilhas', kind: 'folder' });
        expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('q')).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
        expect(await client.resource(tokens('google_sheets'), 'root')).toMatchObject({ id: 'root', name: 'Todas as planilhas', kind: 'folder' });
    });
    it('offers whole My Drive even when there are no selectable folders, without repeating it in children or later pages', async () => {
        const fetcher = transport({ files: [], nextPageToken: 'next' }, { files: [] }, { files: [{ id: 'doc', name: 'Brief.pdf', mimeType: 'application/pdf' }] });
        const client = createWorkspaceProviderClient('google_drive', config, fetcher);
        const first = await client.resources(tokens('google_drive'));
        expect(first.items).toContainEqual(expect.objectContaining({ id: 'root', name: 'Meu Drive inteiro', kind: 'folder' }));
        const next = await client.resources(tokens('google_drive'), { page: first.nextPage! });
        expect(next.items).toEqual([]);
        const children = await client.resources(tokens('google_drive'), { parentId: 'root' });
        expect(children.items.map(item => item.id)).toEqual(['doc']);
        expect(new URL(String(fetcher.mock.calls[2]![0])).searchParams.get('q')).toContain("'root' in parents");
    });
    it('validates the native Drive root with the provider while preserving its selectable alias', async () => {
        const fetcher = transport({ id: 'real-root-id', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder' });
        const root = await createWorkspaceProviderClient('google_drive', config, fetcher).resource(tokens('google_drive'), 'root');
        expect(root).toMatchObject({ id: 'root', name: 'Meu Drive inteiro', kind: 'folder', url: 'https://drive.google.com/drive/my-drive' });
        expect(String(fetcher.mock.calls[0]![0])).toContain('/drive/v3/files/root?');
    });
    it('does not invent whole Drive access when the provider denies root metadata', async () => {
        const client = createWorkspaceProviderClient('google_drive', config, transport(new Response(null, { status: 403 })));
        await expect(client.resource(tokens('google_drive'), 'root')).rejects.toMatchObject({ code: 'workspace_permission_required' });
    });
    it('exposes only native operations authorized for each independent service', () => {
        const drive = createWorkspaceProviderClient('google_drive', config);
        expect(drive.message).toBeUndefined();
        expect(drive.createDraft).toBeUndefined();
        expect(drive.publishEvent).toBeUndefined();
        const calendar = createWorkspaceProviderClient('microsoft_calendar', config);
        expect(calendar.publishEvent).toBeTypeOf('function');
        expect(calendar.sendDraft).toBeUndefined();
        const search = createWorkspaceProviderClient('google_search_console', config);
        expect(search.searchReport).toBeTypeOf('function');
        expect(search.sheet).toBeUndefined();
    });
    it('Drive lists paged folders/files and escapes query values without accepting arbitrary URL pagination', async () => {
        const fetcher = transport({ files: [{ id: 'f', name: 'Brief', mimeType: 'application/vnd.google-apps.folder', webViewLink: 'https://drive.google.com/drive/folders/f' }], nextPageToken: 'next' }, { files: [] });
        const client = createWorkspaceProviderClient('google_drive', config, fetcher);
        const first = await client.resources(tokens('google_drive'), { search: "Bob's" });
        expect(first.items[0]!.kind).toBe('folder');
        expect(first.nextPage).not.toBe('next');
        await client.resources(tokens('google_drive'), { search: "Bob's", page: first.nextPage! });
        expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.get('pageToken')).toBe('next');
        await expect(client.resources(tokens('google_drive'), { page: 'https://attacker.test' })).rejects.toMatchObject({ code: 'workspace_invalid_input' });
    });
    it('Drive resource rejects unsafe navigation links', async () => {
        const resource = await createWorkspaceProviderClient('google_drive', config, transport({ id: 'f', name: 'Brief', mimeType: 'application/pdf', webViewLink: 'https://attacker.test' })).resource(tokens('google_drive'), 'f');
        expect(resource.url).toBeNull();
    });
    it('discovers OneDrive and SharePoint sites and browses a SharePoint document library', async () => {
        const fetcher = transport({ id: 'drive1', name: 'OneDrive', webUrl: 'https://company-my.sharepoint.com/personal/user' }, { value: [{ id: 'site1', displayName: 'Marketing', webUrl: 'https://company.sharepoint.com/sites/marketing' }] }, { value: [{ id: 'library1', name: 'Documents', webUrl: 'https://company.sharepoint.com/sites/marketing/documents' }] }, { value: [{ id: 'file1', name: 'Brief.pdf', file: { mimeType: 'application/pdf' }, webUrl: 'https://company.sharepoint.com/sites/marketing/brief.pdf' }] });
        const client = createWorkspaceProviderClient('microsoft_files', config, fetcher);
        const root = await client.resources(tokens('microsoft_files'));
        expect(root.items.map(item => item.kind)).toEqual(['folder', 'site']);
        const libraries = await client.resources(tokens('microsoft_files'), { parentId: root.items[1]!.id });
        const files = await client.resources(tokens('microsoft_files'), { parentId: libraries.items[0]!.id });
        expect(files.items[0]!.kind).toBe('file');
        expect(String(fetcher.mock.calls[3]![0])).toContain('/drives/library1/root/children');
    });
    it('blocks hostile Graph nextLinks before any follow-up request', async () => {
        const client = createWorkspaceProviderClient('microsoft_calendar', config, transport({ value: [], '@odata.nextLink': 'https://attacker.test/steal' }));
        await expect(client.resources(tokens('microsoft_calendar'))).rejects.toMatchObject({ code: 'workspace_invalid_response' });
    });
    it('searches inside the chosen Microsoft folder with an escaped native query', async () => {
        const fetcher = transport({ value: [] });
        const parentId = 'drive:' + Buffer.from(JSON.stringify(['library', 'folder'])).toString('base64url');
        await createWorkspaceProviderClient('microsoft_files', config, fetcher).resources(tokens('microsoft_files'), { parentId, search: "Bob's brief" });
        const url = new URL(String(fetcher.mock.calls[0]![0]));
        expect(url.origin).toBe('https://graph.microsoft.com');
        expect(decodeURIComponent(url.pathname)).toBe("/v1.0/drives/library/items/folder/search(q='Bob''s brief')");
    });
    it('preserves a partial page when a provider cursor exceeds the public query limit', async () => {
        const body = { value: [{ id: 'c', name: 'Marketing', canEdit: true }], '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendars?$top=50&$select=id,name,canEdit&$skiptoken=${'a'.repeat(5000)}` };
        const page = await createWorkspaceProviderClient('microsoft_calendar', config, transport(body)).resources(tokens('microsoft_calendar'));
        expect(page.items).toHaveLength(1);expect(page.nextPage).toBeNull();expect(page.truncated).toBe(true);
    });
    it('accepts compact Graph skip cursors bound to the same resource discovery context', async () => {
        const fetcher = transport({ value: [{ id: 'c', name: 'Marketing', canEdit: true }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$top=50&$select=id,name,canEdit&$skip=50' }, { value: [] });
        const client = createWorkspaceProviderClient('microsoft_calendar', config, fetcher);
        const first = await client.resources(tokens('microsoft_calendar'));
        expect(first.items[0]!.writable).toBe(true);
        await client.resources(tokens('microsoft_calendar'), { page: first.nextPage! });
        expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.get('$skip')).toBe('50');
        await expect(client.resources(tokens('microsoft_calendar'), { search: 'changed', page: first.nextPage! })).rejects.toMatchObject({ code: 'workspace_invalid_input' });
    });
    it('rejects same-origin Graph nextLinks targeting another API path', async () => {
        await expect(createWorkspaceProviderClient('microsoft_calendar', config, transport({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=50' })).resources(tokens('microsoft_calendar'))).rejects.toMatchObject({ code: 'workspace_invalid_response' });
    });
    it('allows OneNote package resources without rejecting the complete file listing', async () => {
        const parent = 'drive:' + Buffer.from(JSON.stringify(['d', 'root'])).toString('base64url');
        const result = await createWorkspaceProviderClient('microsoft_files', config, transport({ value: [{ id: 'n', name: 'Notebook', package: { type: 'oneNote' }, webUrl: 'https://company.sharepoint.com/n' }] })).resources(tokens('microsoft_files'), { parentId: parent });
        expect(result.items[0]!.kind).toBe('file');
    });
    it('rejects path traversal resource IDs before any request', async () => {
        const fetcher = transport();
        await expect(createWorkspaceProviderClient('google_drive', config, fetcher).resource(tokens('google_drive'), '..')).rejects.toMatchObject({ code: 'workspace_invalid_input' });
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('supports SharePoint-only users whose personal OneDrive has not been provisioned', async () => {
        const client = createWorkspaceProviderClient('microsoft_files', config, transport(new Response(null, { status: 404 }), { value: [{ id: 'site', displayName: 'Marketing', webUrl: 'https://company.sharepoint.com/sites/marketing' }] }));
        expect((await client.resources(tokens('microsoft_files'))).items.map(item => item.kind)).toEqual(['site']);
    });
    it('returns Graph parent reference as a provider resource ID for campaign link validation', async () => {
        const id = 'drive:' + Buffer.from(JSON.stringify(['library', 'item'])).toString('base64url');
        const parent = 'drive:' + Buffer.from(JSON.stringify(['library', 'parent'])).toString('base64url');
        const row = await createWorkspaceProviderClient('microsoft_files', config, transport({ id: 'item', name: 'Brief', file: { mimeType: 'application/pdf' }, parentReference: { driveId: 'library', id: 'parent' } })).resource(tokens('microsoft_files'), id);
        expect(row.parentId).toBe(parent);
    });
    it('folds long MIME subject words and recipient headers at safe boundaries', async () => {
        const fetcher = transport({ id: 'draft', message:{id:'m'} });
        const client = createWorkspaceProviderClient('google_gmail', config, fetcher);
        await client.createDraft!(tokens('google_gmail'), { to: Array.from({ length: 10 }, (_, i) => 'a'.repeat(100) + i + '@company.test'), subject: 'Campanha de verão '.repeat(40), text: 'Body' });
        const raw = Buffer.from(JSON.parse(fetcher.mock.calls[0]![1].body).message.raw, 'base64url').toString();
        expect(raw.split('\r\n').every(line => line.length <= 998)).toBe(true);
        const words = raw.match(/=\?UTF-8\?B\?[^?]+\?=/g)!;
        expect(words.every(word => word.length <= 75)).toBe(true);
        expect(words.map(word => Buffer.from(word.slice(10, -2), 'base64').toString()).join('')).toBe('Campanha de verão '.repeat(40));
    });
    it('reads Gmail metadata and selected plain-text message, then creates a MIME draft and explicitly sends', async () => {
        const gmail = { id: 'm', internalDate: '1790848800000', snippet: 'Preview', payload: { headers: [{ name: 'Subject', value: 'Hello' }, { name: 'From', value: 'a@test.local' }], mimeType: 'text/plain', body: { data: Buffer.from('Plain body').toString('base64url') } } };
        const fetcher = transport({ messages: [{ id: 'm' }] }, gmail, gmail, { id: 'draft', message: { id: 'm' } }, { id: 'sent' });
        const client = createWorkspaceProviderClient('google_gmail', config, fetcher);
        expect((await client.messages!(tokens('google_gmail'), 'INBOX')).items[0]!.subject).toBe('Hello');
        expect((await client.message!(tokens('google_gmail'), 'm')).text).toBe('Plain body');
        expect(await client.createDraft!(tokens('google_gmail'), { to: ['b@test.local'], subject: 'Olá', text: 'Body' })).toMatchObject({id:'draft',revision:'m'});
        const raw = Buffer.from(JSON.parse(fetcher.mock.calls[3]![1].body).message.raw, 'base64url').toString();
        expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
        expect(await client.sendDraft!(tokens('google_gmail'), 'draft')).toEqual({ id: 'sent' });
    });
    it('rejects recipient and subject header injection before Gmail provider request', async () => {
        const fetcher = transport();
        const client = createWorkspaceProviderClient('google_gmail', config, fetcher);
        await expect(client.createDraft!(tokens('google_gmail'), { to: ['a@test.local\r\nBcc: victim@test.local'], subject: 'Hello', text: 'Body' })).rejects.toMatchObject({ code: 'workspace_invalid_input' });
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('never retries an ambiguous provider send failure', async () => {
        const fetcher = vi.fn(async () => { throw new Error('socket failed after send'); }) as unknown as typeof fetch;
        await expect(createWorkspaceProviderClient('microsoft_mail', config, fetcher).sendDraft!(tokens('microsoft_mail'), 'draft')).rejects.toMatchObject({ code: 'workspace_provider_unavailable' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('sends the exact reviewed Gmail snapshot atomically with the native draft send',async()=>{
        const fetcher=transport({id:'sent'});const reviewed={to:['approved@test.local'],subject:'Approved',text:'Reviewed content'};
        await createWorkspaceProviderClient('google_gmail',config,fetcher).sendDraft!(tokens('google_gmail'),'draft',reviewed);
        const body=JSON.parse(fetcher.mock.calls[0]![1].body);expect(body.id).toBe('draft');
        const raw=Buffer.from(body.message.raw,'base64url').toString();
        expect(raw).toContain('To: approved@test.local');expect(raw).toContain(Buffer.from('Reviewed content').toString('base64'));
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('reads provider draft content for comparison with the human reviewed snapshot', async () => {
        const gmail = { id: 'draft', message: { id: 'm', payload: { mimeType: 'text/plain', headers: [{ name: 'To', value: 'b@test.local' }, { name: 'Subject', value: '=?UTF-8?B?T2zDoQ==?=' }], body: { data: Buffer.from('Body').toString('base64url') } } } };
        expect(await createWorkspaceProviderClient('google_gmail', config, transport(gmail)).getDraft!(tokens('google_gmail'), 'draft')).toEqual({ id: 'draft', subject: 'Olá', to: ['b@test.local'], text: 'Body',revision:'m' });
        const outlook = { id: 'draft',changeKey:'revision1', isDraft: true, subject: 'Hello', toRecipients: [{ emailAddress: { address: 'b@test.local' } }], ccRecipients: [], bccRecipients: [], hasAttachments: false, body: { contentType: 'text', content: 'Body' } };
        expect(await createWorkspaceProviderClient('microsoft_mail', config, transport(outlook)).getDraft!(tokens('microsoft_mail'), 'draft')).toEqual({ id: 'draft', subject: 'Hello', to: ['b@test.local'], text: 'Body',revision:'revision1' });
    });
    it('blocks externally added hidden recipients or attachments on previously reviewed drafts', async () => {
        const outlook = { id: 'draft', isDraft: true, subject: 'Hello', toRecipients: [{ emailAddress: { address: 'b@test.local' } }], ccRecipients: [], bccRecipients: [{ emailAddress: { address: 'hidden@test.local' } }], hasAttachments: false, body: { contentType: 'text', content: 'Body' } };
        await expect(createWorkspaceProviderClient('microsoft_mail', config, transport(outlook)).getDraft!(tokens('microsoft_mail'), 'draft')).rejects.toMatchObject({ code: 'workspace_draft_changed' });
        const gmail = { id: 'draft', message: { payload: { mimeType: 'multipart/mixed', headers: [{ name: 'To', value: 'b@test.local' }, { name: 'Subject', value: 'Hello' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Body').toString('base64url') } }, { mimeType: 'application/pdf', filename: 'external.pdf', body: { attachmentId: 'a' } }] } } };
        await expect(createWorkspaceProviderClient('google_gmail', config, transport(gmail)).getDraft!(tokens('google_gmail'), 'draft')).rejects.toMatchObject({ code: 'workspace_draft_changed' });
    });
    it('lists Gmail folders and verified Search Console sites through native APIs', async () => {
        expect((await createWorkspaceProviderClient('google_gmail', config, transport({ labels: [{ id: 'INBOX', name: 'Inbox' }] })).resources(tokens('google_gmail'))).items[0]!.kind).toBe('mailbox');
        const result = await createWorkspaceProviderClient('google_search_console', config, transport({ siteEntry: [{ siteUrl: 'sc-domain:company.test', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:hidden.test', permissionLevel: 'siteUnverifiedUser' }] })).resources(tokens('google_search_console'));
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.id).toBe('sc-domain:company.test');
    });
    it('filters Sheets discovery to spreadsheets and bounds provider collection size', async () => {
        const fetcher = transport({ files: [] });
        await createWorkspaceProviderClient('google_sheets', config, fetcher).resources(tokens('google_sheets'));
        expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('q')).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
        await expect(createWorkspaceProviderClient('google_drive', config, transport({ files: Array.from({ length: 101 }, () => ({})) })).resources(tokens('google_drive'))).rejects.toMatchObject({ code: 'workspace_invalid_response' });
    });
    it('Outlook reads text messages, creates drafts and recognizes 202 send acceptance without retry', async () => {
        const fetcher = transport({ id: 'm', subject: 'Hello', from: { emailAddress: { address: 'a@test.local' } }, receivedDateTime: event.start, bodyPreview: 'Preview', body: { contentType: 'text', content: 'Plain body' } }, { id: 'draft',changeKey:'v1' }, new Response(null, { status: 202 }));
        const client = createWorkspaceProviderClient('microsoft_mail', config, fetcher);
        expect((await client.message!(tokens('microsoft_mail'), 'm')).text).toBe('Plain body');
        expect((await client.createDraft!(tokens('microsoft_mail'), { to: ['b@test.local'], subject: 'Hello', text: 'Body' })).revision).toBe('v1');
        expect(await client.sendDraft!(tokens('microsoft_mail'), 'draft')).toEqual({ id: 'draft' });
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it('Google calendar publishes a stable base32hex event ID and lists events', async () => {
        const fetcher = transport(googleEvent, { items: [googleEvent] });
        const client = createWorkspaceProviderClient('google_calendar', config, fetcher);
        await client.publishEvent!(tokens('google_calendar'), 'calendar@test.local', event);
        const body = JSON.parse(fetcher.mock.calls[0]![1].body);
        expect(body.id).toMatch(/^[0-9a-v]{5,1024}$/);
        expect(body.start.timeZone).toBe(event.timeZone);
        expect((await client.events!(tokens('google_calendar'), 'calendar@test.local', event.start, event.end)).items[0]!.title).toBe('Launch');
    });
    it.each(['google_calendar', 'microsoft_calendar'] as WorkspaceService[])('includes the final day for calendar date-only periods: %s', async (service) => {
        const fetcher = transport(service === 'google_calendar' ? { items: [] } : { value: [] });
        await createWorkspaceProviderClient(service, config, fetcher).events!(tokens(service), 'c', '2026-10-01', '2026-10-01');
        const url = new URL(String(fetcher.mock.calls[0]![0]));
        expect(url.searchParams.get(service === 'google_calendar' ? 'timeMin' : 'startDateTime')).toBe('2026-10-01T00:00:00.000Z');
        expect(url.searchParams.get(service === 'google_calendar' ? 'timeMax' : 'endDateTime')).toBe('2026-10-02T00:00:00.000Z');
    });
    it('does not fabricate a received date from a null Gmail timestamp and decodes MIME subjects', async () => {
        const msg = { id: 'm', internalDate: null, payload: { headers: [{ name: 'Subject', value: '=?UTF-8?B?T2zDoQ==?=' }] } };
        await expect(createWorkspaceProviderClient('google_gmail', config, transport(msg)).message!(tokens('google_gmail'), 'm')).rejects.toMatchObject({ code: 'workspace_invalid_response' });
        expect((await createWorkspaceProviderClient('google_gmail', config, transport({ ...msg, internalDate: '1790848800000' })).message!(tokens('google_gmail'), 'm')).subject).toBe('Olá');
    });
    it('Microsoft calendar publishes with transactionId and UTC event instants', async () => {
        const fetcher = transport(graphEvent);
        const client = createWorkspaceProviderClient('microsoft_calendar', config, fetcher);
        expect((await client.publishEvent!(tokens('microsoft_calendar'), 'c', event)).start).toBe(event.start);
        const body = JSON.parse(fetcher.mock.calls[0]![1].body);
        expect(body.transactionId).toBeTruthy();
        expect(body.start.timeZone).toBe('UTC');
    });
    it('Sheets discovers first tab and reads bounded displayed rows with explicit truncation', async () => {
        const fetcher = transport({ sheets: [{ properties: { title: "Manager's report", index: 0, gridProperties: { rowCount: 10000, columnCount: 100 } } }] }, { values: [['Email', 'Amount'], ['a@test.local', '1,50']] });
        const client = createWorkspaceProviderClient('google_sheets', config, fetcher);
        const result = await client.sheet!(tokens('google_sheets'), 's');
        expect(result).toMatchObject({ name: "Manager's report", headers: ['Email', 'Amount'], rows: [['a@test.local', '1,50']], truncated: true });
        expect(decodeURIComponent(String(fetcher.mock.calls[1]![0]))).toContain("'Manager''s report'!A1:AZ501");
    });
    it('Search Console uses separate aggregate totals instead of summing top query rows', async () => {
        const metric = { clicks: 10, impressions: 100, ctr: 0.1, position: 3 };
        const fetcher = transport({ rows: [metric] }, { rows: [{ ...metric, keys: ['2026-10-01'] }] }, { rows: [{ ...metric, clicks: 4, keys: ['https://company.test/'] }] }, { rows: [{ ...metric, clicks: 2, keys: ['marketing'] }] });
        const result = await createWorkspaceProviderClient('google_search_console', config, fetcher).searchReport!(tokens('google_search_console'), 'sc-domain:company.test', '2026-10-01', '2026-10-01');
        expect(result.totals!.clicks).toBe(10);
        expect(result.queries[0]!.clicks).toBe(2);
        expect(result.truncated).toBe(true);
        expect(fetcher.mock.calls.map(call => JSON.parse(call[1].body).dimensions ?? [])).toEqual([[], ['date'], ['page'], ['query']]);
    });
    it('rejects invalid Search Console dates before provider calls', async () => {
        const fetcher = transport();
        await expect(createWorkspaceProviderClient('google_search_console', config, fetcher).searchReport!(tokens('google_search_console'), 'site', 'invalid', '2026-10-01')).rejects.toMatchObject({ code: 'workspace_invalid_input' });
        expect(fetcher).not.toHaveBeenCalled();
    });
});
