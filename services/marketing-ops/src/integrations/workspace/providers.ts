import { createHash } from 'node:crypto';
import { appError } from '../../errors.js';
import { workspaceFamily } from './types.js';
import type { SearchConsoleReport, WorkspaceProviderClient, WorkspaceService, WorkspaceAppConfig, WorkspaceTokens, WorkspaceIdentity, WorkspaceResource, WorkspacePage, WorkspaceMessage, WorkspaceDraft, WorkspaceMailInput, WorkspaceEvent, WorkspaceEventInput, WorkspaceSheet } from './types.js';
// Native REST APIs only. Requests stay server-side; cursors never become URLs.
const G = 'https://www.googleapis.com';
const M = 'https://graph.microsoft.com/v1.0';
const googleIdentityScopes = ['openid', 'email', 'profile'];
const capabilities: Record<WorkspaceService, string[]> = {
    google_drive: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
    google_gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
    google_calendar: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'],
    google_sheets: ['https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    google_search_console: ['https://www.googleapis.com/auth/webmasters.readonly'],
    microsoft_files: ['User.Read', 'Files.Read.All', 'Sites.Read.All'],
    microsoft_mail: ['User.Read', 'Mail.ReadWrite', 'Mail.Send'],
    microsoft_calendar: ['User.Read', 'Calendars.ReadWrite']
};
export function workspaceScopes(service: WorkspaceService): string[] {
    return [...(workspaceFamily(service) === 'google' ? googleIdentityScopes : ['openid', 'profile', 'email', 'offline_access']), ...capabilities[service]];
}
const invalid = () => appError('workspace_invalid_response', 502, 'Workspace provider returned an invalid response');
const inputError = () => appError('workspace_invalid_input', 422, 'Workspace input is invalid');
const permission = () => appError('workspace_permission_required', 403, 'Workspace permission is required');
const object = (value: unknown): Record<string, any> => { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid(); return value as Record<string, any>; };
const str = (value: unknown, maximum = 2000): string => { if (typeof value !== 'string' || !value || value.length > maximum)
    throw invalid(); return value; };
const optionalText = (value: unknown, maximum = 100000): string => { if (value === undefined || value === null)
    return ''; if (typeof value !== 'string' || value.length > maximum)
    throw invalid(); return value; };
const array = (value: unknown, maximum = 100): any[] => { if (!Array.isArray(value) || value.length > maximum)
    throw invalid(); return value; };
const idInput = (id: unknown): string => { if (typeof id !== 'string' || !id || id === '.' || id === '..' || id.length > 2000 || /[\x00-\x1f\x7f]/.test(id))
    throw inputError(); return id; };
const pathId = (id: string) => encodeURIComponent(idInput(id));
const deadline = () => AbortSignal.timeout(90000);
function safeLink(value: unknown, family: 'google' | 'microsoft'): string | null {
    if (typeof value !== 'string' || value.length > 4000)
        return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port)
            return null;
        const host = url.hostname;
        const allowed = family === 'google' ? ['drive.google.com', 'docs.google.com', 'calendar.google.com', 'mail.google.com', 'search.google.com'].includes(host) : ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com', 'onedrive.live.com'].includes(host) || host.endsWith('.sharepoint.com') || host.endsWith('.onedrive.com');
        return allowed ? url.toString() : null;
    }
    catch {
        return null;
    }
}
async function boundedText(response: Response, maximum: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader)
        return '';
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > maximum) {
                await reader.cancel();
                throw invalid();
            }
            chunks.push(part.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
}
async function json(fetcher: typeof fetch, url: string | URL, init: RequestInit = {}, allowEmpty = false): Promise<any> {
    try {
        const signal = init.signal ?? AbortSignal.timeout(30000);
        signal.throwIfAborted();
        const response = await fetcher(url, { ...init, redirect: 'error', signal });
        if (!response.ok) {
            let failure: any;
            try {
                failure = JSON.parse(await boundedText(response, 8192));
            }
            catch { /* Fixed protocol codes only. */ }
            if (response.status === 401 || failure?.error === 'invalid_grant')
                throw appError('workspace_reconnect_required', 401, 'Workspace authorization must be renewed');
            if (response.status === 403 && (failure?.error?.details?.some?.((entry: any) => entry?.reason === 'SERVICE_DISABLED') || failure?.error?.errors?.some?.((entry: any) => entry?.reason === 'accessNotConfigured')))
                throw appError('workspace_api_disabled', 403, 'Enable the required Workspace API');
            if (response.status === 403)
                throw permission();
            if (response.status === 404)
                throw appError('workspace_resource_unavailable', 404, 'Workspace resource is unavailable');
            if (response.status === 409)
                throw appError('workspace_conflict', 409, 'Workspace resource already exists');
            if (response.status === 429)
                throw appError('workspace_rate_limited', 429, 'Workspace provider quota is exhausted');
            throw appError('workspace_provider_unavailable', 502, 'Workspace provider is unavailable');
        }
        const text = await boundedText(response, 2000000);
        if (allowEmpty && !text && [202, 204].includes(response.status))
            return null;
        try {
            return object(JSON.parse(text));
        }
        catch {
            throw invalid();
        }
    }
    catch (error) {
        if (typeof (error as any)?.code === 'string' && (error as any).code.startsWith('workspace_'))
            throw error;
        throw appError('workspace_provider_unavailable', 502, 'Workspace provider is unavailable');
    }
}
type Cursor = {
    v: 1;
    service: WorkspaceService;
    context: string;
    token: string;
    mode?: 'skip';
};
function encodeCursor(cursor: Cursor): string | null {
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    // Match the public query contract; large provider cursors leave an honest
    // partial page instead of returning a next-page link the app cannot use.
    return encoded.length <= 4000 ? encoded : null;
}
function decodeCursor(page: string | undefined, service: WorkspaceService, context: string): Cursor | null {
    if (!page)
        return null;
    if (page.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(page))
        throw inputError();
    try {
        const value = JSON.parse(Buffer.from(page, 'base64url').toString());
        if (value.v !== 1 || value.service !== service || value.context !== context || typeof value.token !== 'string' || !value.token || value.token.length > 8000 || value.mode && value.mode !== 'skip')
            throw inputError();
        return value;
    }
    catch {
        throw inputError();
    }
}
function nextGraph(value: unknown, service: WorkspaceService, url: URL, context: string): string | null {
    if (value === undefined || value === null)
        return null;
    try {
        const next = new URL(str(value, 12000));
        if (next.origin !== 'https://graph.microsoft.com' || next.username || next.password || next.pathname !== url.pathname || next.hash)
            throw invalid();
        for (const [key, val] of next.searchParams)
            if (!['$skiptoken', '$skip'].includes(key) && url.searchParams.get(key) !== val)
                throw invalid();
        const token = next.searchParams.get('$skiptoken');
        const skip = next.searchParams.get('$skip');
        if (token && token.length <= 8000 && !skip)
            return encodeCursor({ v: 1, service, context, token });
        if (skip && /^\d{1,8}$/.test(skip) && !token)
            return encodeCursor({ v: 1, service, context, token: skip, mode: 'skip' });
        throw invalid();
    }
    catch {
        throw invalid();
    }
}
function msId(drive: string, item = 'root'): string { return 'drive:' + Buffer.from(JSON.stringify([drive, item])).toString('base64url'); }
function msSite(site: string): string { return 'site:' + Buffer.from(site).toString('base64url'); }
function parseMsId(id: string): {
    drive?: string;
    item?: string;
    site?: string;
} {
    idInput(id);
    try {
        if (id.startsWith('site:'))
            return { site: idInput(Buffer.from(id.slice(5), 'base64url').toString()) };
        if (id.startsWith('drive:')) {
            const parts = JSON.parse(Buffer.from(id.slice(6), 'base64url').toString());
            if (!Array.isArray(parts) || parts.length !== 2)
                throw inputError();
            return { drive: idInput(parts[0]), item: idInput(parts[1]) };
        }
        throw inputError();
    }
    catch {
        throw inputError();
    }
}
function googleFile(row: any): WorkspaceResource {
    row = object(row);
    const mimeType = str(row.mimeType);
    const id = str(row.id);
    return { id, name: str(row.name), kind: mimeType === 'application/vnd.google-apps.folder' ? 'folder' : mimeType === 'application/vnd.google-apps.spreadsheet' ? 'spreadsheet' : 'file', mimeType, url: safeLink(row.webViewLink, 'google'), ...(Array.isArray(row.parents) && row.parents[0] ? { parentId: str(row.parents[0]) } : {}) };
}
function graphFile(row: any, drive: string): WorkspaceResource {
    row = object(row);
    if (!row.folder && !row.file && !row.package && row.id !== 'root')
        throw invalid();
    return { id: msId(drive, str(row.id)), name: str(row.name), kind: row.folder || row.id === 'root' ? 'folder' : 'file', url: safeLink(row.webUrl, 'microsoft'), ...(row.file?.mimeType ? { mimeType: str(row.file.mimeType) } : {}), ...(row.parentReference?.id ? { parentId: msId(row.parentReference.driveId ? str(row.parentReference.driveId) : drive, str(row.parentReference.id)) } : {}) };
}
function googleCalendar(row: any): WorkspaceResource { row = object(row); return { id: str(row.id), name: str(row.summary), kind: 'calendar', url: 'https://calendar.google.com/', writable: ['owner', 'writer'].includes(row.accessRole) }; }
function graphCalendar(row: any): WorkspaceResource { row = object(row); if (typeof row.canEdit !== 'boolean')
    throw invalid(); return { id: str(row.id), name: str(row.name), kind: 'calendar', url: 'https://outlook.office.com/calendar/', writable: row.canEdit }; }
function checkMail(input: WorkspaceMailInput): void {
    if (!Array.isArray(input.to) || !input.to.length || input.to.length > 50 || input.to.some(to => typeof to !== 'string' || to.length > 254 || !/^[^\s<>(),;:\r\n]+@[^\s<>(),;:\r\n]+\.[^\s<>(),;:\r\n]+$/.test(to)) || typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 998 || /[\r\n\x00]/.test(input.subject) || typeof input.text !== 'string' || input.text.length > 100000)
        throw inputError();
}
function mimeSubject(subject: string): string {
    const words: string[] = [];
    let chunk = '';
    // RFC 2047: encoded words fit 75 characters and never split a UTF-8 codepoint.
    for (const char of subject) {
        if (Buffer.byteLength(chunk + char) > 42) {
            words.push('=?UTF-8?B?' + Buffer.from(chunk).toString('base64') + '?=');
            chunk = '';
        }
        chunk += char;
    }
    if (chunk)
        words.push('=?UTF-8?B?' + Buffer.from(chunk).toString('base64') + '?=');
    return words.join('\r\n ');
}
const changedDraft = () => appError('workspace_draft_changed', 409, 'Provider draft changed; review a new draft before sending');
function mailRaw(input: WorkspaceMailInput): string {
    checkMail(input);
    const mime = `To: ${input.to.join(',\r\n ')}\r\nSubject: ${mimeSubject(input.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(input.text).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''}`;
    return Buffer.from(mime).toString('base64url');
}
function decodeHeader(value: string): string {
    return value.replace(/\?=\s+(?==\?)/g, '?=').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_all, charset: string, encoding: string, data: string) => {
        try {
            const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
            return new TextDecoder(charset, { fatal: true }).decode(bytes);
        }
        catch {
            throw invalid();
        }
    });
}
function gmailDraft(row: any): WorkspaceDraft {
    row = object(row);
    const payload = object(row.message?.payload);
    const headers = array(payload.headers, 200);
    const header = (name: string) => { const matches = headers.filter(h => typeof h?.name === 'string' && h.name.toLowerCase() === name); if (matches.length > 1)
        throw changedDraft(); return optionalText(matches[0]?.value, 10000).replace(/\r?\n[ \t]+/g, ' '); };
    if (header('cc').trim() || header('bcc').trim() || header('reply-to').trim())
        throw changedDraft();
    const recipients = header('to').split(',').map(to => { const match = to.trim().match(/^(?:[^<>]*<)?([^<>\s,]+@[^<>\s,]+)>?$/); if (!match?.[1])
        throw changedDraft(); return match[1]; });
    if (!recipients.length || recipients.length > 50)
        throw changedDraft();
    let text = '';
    let visited = 0;
    const walk = (part: any, depth = 0) => { if (++visited > 100 || depth > 10)
        throw invalid(); part = object(part); if (part.filename || part.body?.attachmentId)
        throw changedDraft(); if (part.mimeType === 'text/plain') {
        if (part.body?.data) {
            const data = str(part.body.data, 200000);
            if (!/^[A-Za-z0-9_=-]+$/.test(data))
                throw invalid();
            text += Buffer.from(data, 'base64url').toString('utf8');
        }
    }
    else if (typeof part.mimeType === 'string' && part.mimeType.startsWith('multipart/')) {
        for (const child of array(part.parts, 100))
            walk(child, depth + 1);
    }
    else
        throw changedDraft(); if (text.length > 100000)
        throw invalid(); };
    walk(payload);
    return { id: str(row.id), subject: decodeHeader(header('subject')), to: recipients, text, revision: str(row.message.id) };
}
function graphDraft(row: any): WorkspaceDraft {
    row = object(row);
    if (row.isDraft !== true || row.hasAttachments !== false || array(row.ccRecipients ?? [], 50).length || array(row.bccRecipients ?? [], 50).length || array(row.replyTo ?? [], 50).length || row.body?.contentType?.toLowerCase() !== 'text')
        throw changedDraft();
    return { id: str(row.id), subject: optionalText(row.subject, 1000), to: array(row.toRecipients, 50).map(recipient => str(recipient?.emailAddress?.address, 254)), text: optionalText(row.body?.content, 100000), revision: str(row.changeKey) };
}
function range(from: string, to: string, dateOnly = false): void {
    if (dateOnly && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)))
        throw inputError();
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 366 * 86400000 || dateOnly && (new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to))
        throw inputError();
}
function checkEvent(input: WorkspaceEventInput): void {
    range(input.start, input.end);
    if (Date.parse(input.start) === Date.parse(input.end) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500 || typeof input.description !== 'string' || input.description.length > 10000 || typeof input.externalKey !== 'string' || !input.externalKey || input.externalKey.length > 2000)
        throw inputError();
    try {
        new Intl.DateTimeFormat('en', { timeZone: input.timeZone });
    }
    catch {
        throw inputError();
    }
}
function googleEvent(row: any): WorkspaceEvent {
    row = object(row);
    const start = str(row.start?.dateTime ?? row.start?.date);
    const end = str(row.end?.dateTime ?? row.end?.date);
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)))
        throw invalid();
    return { id: str(row.id), title: optionalText(row.summary, 500) || '(Sem título)', start, end, url: safeLink(row.htmlLink, 'google') };
}
function graphEvent(row: any): WorkspaceEvent {
    row = object(row);
    const instant = (value: any) => { const text = str(value?.dateTime, 100); if (value?.timeZone !== 'UTC' && !/[Zz]|[+-]\d\d:\d\d$/.test(text))
        throw invalid(); const n = Date.parse(/[Zz]|[+-]\d\d:\d\d$/.test(text) ? text : text + 'Z'); if (!Number.isFinite(n))
        throw invalid(); return new Date(n).toISOString().replace('.000Z', 'Z'); };
    return { id: str(row.id), title: optionalText(row.subject, 500) || '(Sem título)', start: instant(row.start), end: instant(row.end), url: safeLink(row.webLink, 'microsoft') };
}
function gmailMessage(row: any, full: boolean): WorkspaceMessage {
    row = object(row);
    const headers = array(row.payload?.headers ?? [], 200);
    const header = (name: string) => optionalText(headers.find(h => typeof h?.name === 'string' && h.name.toLowerCase() === name)?.value, 2000);
    if (typeof row.internalDate !== 'string' || !/^\d{1,16}$/.test(row.internalDate))
        throw invalid();
    const timestamp = Number(row.internalDate);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8640000000000000)
        throw invalid();
    let plain = '';
    let visited = 0;
    const walk = (part: any, depth = 0) => { if (depth > 10 || ++visited > 100)
        throw invalid(); part = object(part); if (part.mimeType === 'text/plain' && part.body?.data) {
        const data = str(part.body.data, 200000);
        if (!/^[A-Za-z0-9_=-]+$/.test(data))
            throw invalid();
        plain += Buffer.from(data, 'base64url').toString('utf8');
        if (plain.length > 100000)
            throw invalid();
    } if (part.parts)
        for (const child of array(part.parts, 100))
            walk(child, depth + 1); };
    if (full && row.payload)
        walk(row.payload);
    return { id: str(row.id), subject: decodeHeader(header('subject')) || '(Sem assunto)', from: decodeHeader(header('from')), receivedAt: new Date(timestamp).toISOString(), snippet: optionalText(row.snippet, 2000), ...(full ? { text: plain } : {}) };
}
function graphMessage(row: any, full: boolean): WorkspaceMessage {
    row = object(row);
    const receivedAt = str(row.receivedDateTime, 100);
    if (!Number.isFinite(Date.parse(receivedAt)))
        throw invalid();
    if (full && row.body && row.body.contentType?.toLowerCase() !== 'text')
        throw invalid();
    return { id: str(row.id), subject: optionalText(row.subject, 2000) || '(Sem assunto)', from: optionalText(row.from?.emailAddress?.address, 1000), receivedAt, snippet: optionalText(row.bodyPreview, 2000), ...(full ? { text: optionalText(row.body?.content, 100000) } : {}) };
}
class WorkspaceClient implements WorkspaceProviderClient {
    private google: boolean;
    private tenant: string;
    constructor(private service: WorkspaceService, private config: WorkspaceAppConfig, private fetcher: typeof fetch) {
        this.google = workspaceFamily(service) === 'google';
        this.tenant = config.tenantId ?? 'organizations';
        if (!/^(?:organizations|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$/.test(this.tenant))
            throw inputError();
    }
    authorizationUrl(state: string, verifier: string): string {
        const url = new URL(this.google ? 'https://accounts.google.com/o/oauth2/v2/auth' : `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0/authorize`);
        url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: workspaceScopes(this.service).join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...(this.google ? { access_type: 'offline', prompt: 'consent select_account' } : { response_mode: 'query', prompt: 'select_account' }) }).toString();
        return url.toString();
    }
    private async token(form: Record<string, string>, previous?: WorkspaceTokens): Promise<WorkspaceTokens> {
        const body = await json(this.fetcher, this.google ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, client_id: this.config.clientId, client_secret: this.config.clientSecret }) });
        const accessToken = str(body.access_token, 20000);
        const seconds = Number(body.expires_in);
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400)
            throw invalid();
        const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
        const normalize = (scope: string) => this.google ? scope : scope.replace(/^https:\/\/graph\.microsoft\.com\//, '').toLowerCase();
        if (!capabilities[this.service].every(scope => scopes.map(normalize).includes(normalize(scope))))
            throw permission();
        const refreshToken = body.refresh_token === undefined ? previous?.refreshToken : str(body.refresh_token, 20000);
        return { accessToken, ...(refreshToken ? { refreshToken } : {}), expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), scopes };
    }
    exchange(code: string, verifier: string): Promise<WorkspaceTokens> { return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri, code_verifier: verifier, ...(!this.google ? { scope: workspaceScopes(this.service).join(' ') } : {}) }); }
    async refresh(tokens: WorkspaceTokens): Promise<WorkspaceTokens> {
        if (tokens.expiresAt && Date.parse(tokens.expiresAt) > Date.now() + 60000)
            return tokens;
        if (!tokens.refreshToken)
            throw appError('workspace_reconnect_required', 401, 'Workspace authorization must be renewed');
        return this.token({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, ...(!this.google ? { scope: workspaceScopes(this.service).join(' ') } : {}) }, tokens);
    }
    private read(tokens: WorkspaceTokens, url: string | URL, signal: AbortSignal = deadline(), init: RequestInit = {}, allowEmpty = false): Promise<any> {
        return json(this.fetcher, url, { ...init, signal, headers: { Authorization: `Bearer ${tokens.accessToken}`, ...(this.google ? {} : { Prefer: 'outlook.body-content-type="text", outlook.timezone="UTC"' }), ...init.headers } }, allowEmpty);
    }
    private post(tokens: WorkspaceTokens, url: string, body: unknown, signal = deadline(), allowEmpty = false): Promise<any> { return this.read(tokens, url, signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, allowEmpty); }
    async identity(tokens: WorkspaceTokens): Promise<WorkspaceIdentity> {
        const row = await this.read(tokens, this.google ? 'https://openidconnect.googleapis.com/v1/userinfo' : `${M}/me?$select=id,displayName,mail,userPrincipalName`);
        const email = str(this.google ? row.email : row.mail ?? row.userPrincipalName, 254);
        if (!/^[^\s@]+@[^\s@]+$/.test(email))
            throw invalid();
        return { id: str(this.google ? row.sub : row.id), email, name: optionalText(this.google ? row.name : row.displayName, 500) || email };
    }
    private async googlePage<T>(tokens: WorkspaceTokens, url: URL, key: string, mapper: (row: any) => T, context: string, page?: string, signal = deadline()): Promise<WorkspacePage<T>> {
        const cursor = decodeCursor(page, this.service, context);
        if (cursor)
            url.searchParams.set('pageToken', cursor.token);
        const body = await this.read(tokens, url, signal);
        const rows = array(body[key] ?? [], 100);
        const next = body.nextPageToken === undefined ? null : str(body.nextPageToken, 8000);
        return { items: rows.map(mapper), nextPage: next ? encodeCursor({ v: 1, service: this.service, context, token: next }) : null, truncated: !!next || body.incompleteSearch === true };
    }
    private async graphPage<T>(tokens: WorkspaceTokens, url: URL, mapper: (row: any) => T, context: string, page?: string, signal = deadline()): Promise<WorkspacePage<T>> {
        const cursor = decodeCursor(page, this.service, context);
        if (cursor)
            url.searchParams.set(cursor.mode === 'skip' ? '$skip' : '$skiptoken', cursor.token);
        const body = await this.read(tokens, url, signal);
        const items = array(body.value, 100).map(mapper);
        const nextPage = nextGraph(body['@odata.nextLink'], this.service, url, context);
        return { items, nextPage, truncated: body['@odata.nextLink'] != null };
    }
    async resources(tokens: WorkspaceTokens, options: {
        parentId?: string;
        search?: string;
        page?: string;
    } = {}): Promise<WorkspacePage<WorkspaceResource>> {
        const signal = deadline();
        const context = JSON.stringify([this.service, options.parentId ?? '', options.search ?? '']);
        if (options.search !== undefined && (typeof options.search !== 'string' || options.search.length > 200 || /[\x00-\x1f]/.test(options.search)))
            throw inputError();
        if (['google_drive', 'google_sheets'].includes(this.service)) {
            const escaped = (text: string) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const query = ['trashed = false'];
            if (this.service === 'google_sheets')
                query.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
            else if (options.parentId || !options.search)
                query.push(`'${escaped(idInput(options.parentId ?? 'root'))}' in parents`);
            if (options.search)
                query.push(`name contains '${escaped(options.search)}'`);
            const url = new URL(`${G}/drive/v3/files`);
            url.search = new URLSearchParams({ q: query.join(' and '), pageSize: '50', fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,parents)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', orderBy: 'folder,name' }).toString();
            const page = await this.googlePage(tokens, url, 'files', googleFile, context, options.page, signal);
            // The root is a native alias, not an ordinary child of My Drive.
            // Selecting it is still validated through files.get below.
            if (!options.parentId && !options.search && !options.page)
                page.items.unshift({ id: 'root', name: this.service === 'google_drive' ? 'Meu Drive inteiro' : 'Todas as planilhas', kind: 'folder', url: 'https://drive.google.com/drive/my-drive' });
            return page;
        }
        if (this.service === 'google_calendar') {
            const url = new URL(`${G}/calendar/v3/users/me/calendarList?maxResults=50`);
            return this.googlePage(tokens, url, 'items', googleCalendar, context, options.page, signal);
        }
        if (this.service === 'google_gmail') {
            if (options.page)
                throw inputError();
            const body = await this.read(tokens, `${G}/gmail/v1/users/me/labels`, signal);
            return { items: array(body.labels ?? [], 1000).slice(0, 100).map(row => ({ id: str(row.id), name: str(row.name), kind: 'mailbox', url: 'https://mail.google.com/' })), nextPage: null, truncated: (body.labels?.length ?? 0) > 100 };
        }
        if (this.service === 'google_search_console') {
            if (options.page)
                throw inputError();
            const body = await this.read(tokens, `${G}/webmasters/v3/sites`, signal);
            const sites = array(body.siteEntry ?? [], 1000).filter(row => row.permissionLevel !== 'siteUnverifiedUser');
            return { items: sites.slice(0, 100).map(row => ({ id: str(row.siteUrl), name: str(row.siteUrl), kind: 'site', url: 'https://search.google.com/search-console/' })), nextPage: null, truncated: sites.length > 100 };
        }
        if (this.service === 'microsoft_calendar')
            return this.graphPage(tokens, new URL(`${M}/me/calendars?$top=50&$select=id,name,canEdit`), graphCalendar, context, options.page, signal);
        if (this.service === 'microsoft_mail')
            return this.graphPage(tokens, new URL(`${M}/me/mailFolders?$top=50&$select=id,displayName`), row => ({ id: str(row.id), name: str(row.displayName), kind: 'mailbox', url: 'https://outlook.office.com/mail/' }), context, options.page, signal);
        if (options.parentId) {
            const ref = parseMsId(options.parentId);
            if (ref.site)
                return this.graphPage(tokens, new URL(`${M}/sites/${pathId(ref.site)}/drives?$top=50&$select=id,name,webUrl`), row => ({ id: msId(str(row.id)), name: str(row.name), kind: 'folder', url: safeLink(row.webUrl, 'microsoft') }), context, options.page, signal);
            const base = ref.item === 'root' ? `/drives/${pathId(ref.drive!)}/root` : `/drives/${pathId(ref.drive!)}/items/${pathId(ref.item!)}`;
            const search = options.search?.trim();
            const path = search ? `${base}/search(q='${encodeURIComponent(search.replace(/'/g, "''"))}')` : `${base}/children`;
            const url = new URL(M + path);
            url.search = new URLSearchParams({ '$top': '50', '$select': 'id,name,webUrl,file,folder,package,parentReference' }).toString();
            return this.graphPage(tokens, url, row => graphFile(row, ref.drive!), context, options.page, signal);
        }
        // First page includes personal drive, subsequent pages contain SharePoint sites.
        const url = new URL(`${M}/sites`);
        url.search = new URLSearchParams({ search: options.search || '*', '$top': '50', '$select': 'id,displayName,webUrl' }).toString();
        let personal: WorkspaceResource[] = [];
        if (!options.page) {
            try {
                const drive = await this.read(tokens, `${M}/me/drive?$select=id,name,webUrl`, signal);
                personal = [{ id: msId(str(drive.id)), name: optionalText(drive.name, 500) || 'OneDrive', kind: 'folder', url: safeLink(drive.webUrl, 'microsoft') }];
            }
            catch (error) {
                if ((error as any)?.code !== 'workspace_resource_unavailable')
                    throw error;
            }
        }
        const sites = await this.graphPage(tokens, url, row => ({ id: msSite(str(row.id)), name: str(row.displayName), kind: 'site' as const, url: safeLink(row.webUrl, 'microsoft') }), context, options.page, signal);
        return { ...sites, items: [...personal, ...sites.items] };
    }
    async resource(tokens: WorkspaceTokens, id: string): Promise<WorkspaceResource> {
        if (['google_drive', 'google_sheets'].includes(this.service)) {
            const resource = googleFile(await this.read(tokens, `${G}/drive/v3/files/${pathId(id)}?fields=id,name,mimeType,webViewLink,parents&supportsAllDrives=true`));
            if (id === 'root') {
                if (resource.kind !== 'folder') throw invalid();
                return { ...resource, id: 'root', name: this.service === 'google_drive' ? 'Meu Drive inteiro' : 'Todas as planilhas', url: 'https://drive.google.com/drive/my-drive' };
            }
            return resource;
        }
        if (this.service === 'google_calendar')
            return googleCalendar(await this.read(tokens, `${G}/calendar/v3/users/me/calendarList/${pathId(id)}`));
        if (this.service === 'google_gmail') {
            const row = await this.read(tokens, `${G}/gmail/v1/users/me/labels/${pathId(id)}`);
            return { id: str(row.id), name: str(row.name), kind: 'mailbox', url: 'https://mail.google.com/' };
        }
        if (this.service === 'google_search_console') {
            const row = await this.read(tokens, `${G}/webmasters/v3/sites/${pathId(id)}`);
            if (row.permissionLevel === 'siteUnverifiedUser')
                throw permission();
            return { id: str(row.siteUrl), name: str(row.siteUrl), kind: 'site', url: 'https://search.google.com/search-console/' };
        }
        if (this.service === 'microsoft_calendar')
            return graphCalendar(await this.read(tokens, `${M}/me/calendars/${pathId(id)}?$select=id,name,canEdit`));
        if (this.service === 'microsoft_mail') {
            const row = await this.read(tokens, `${M}/me/mailFolders/${pathId(id)}?$select=id,displayName`);
            return { id: str(row.id), name: str(row.displayName), kind: 'mailbox', url: 'https://outlook.office.com/mail/' };
        }
        const ref = parseMsId(id);
        if (ref.site) {
            const row = await this.read(tokens, `${M}/sites/${pathId(ref.site)}?$select=id,displayName,webUrl`);
            return { id: msSite(str(row.id)), name: str(row.displayName), kind: 'site', url: safeLink(row.webUrl, 'microsoft') };
        }
        return graphFile(await this.read(tokens, `${M}/drives/${pathId(ref.drive!)}/${ref.item === 'root' ? 'root' : 'items/' + pathId(ref.item!)}?$select=id,name,webUrl,file,folder,package,parentReference`), ref.drive!);
    }
    async messages(tokens: WorkspaceTokens, resourceId: string): Promise<WorkspacePage<WorkspaceMessage>> {
        const signal = deadline();
        if (this.service === 'google_gmail') {
            const url = new URL(`${G}/gmail/v1/users/me/messages`);
            url.search = new URLSearchParams({ labelIds: idInput(resourceId), maxResults: '20' }).toString();
            const body = await this.read(tokens, url, signal);
            const refs = array(body.messages ?? [], 20);
            const items: WorkspaceMessage[] = [];
            for (let offset = 0; offset < refs.length; offset += 4)
                items.push(...await Promise.all(refs.slice(offset, offset + 4).map(async (row) => gmailMessage(await this.read(tokens, `${G}/gmail/v1/users/me/messages/${pathId(str(row.id))}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, signal), false))));
            return { items, nextPage: null, truncated: typeof body.nextPageToken === 'string' };
        }
        if (this.service === 'microsoft_mail')
            return this.graphPage(tokens, new URL(`${M}/me/mailFolders/${pathId(resourceId)}/messages?$top=20&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`), row => graphMessage(row, false), 'messages:' + resourceId, undefined, signal);
        throw permission();
    }
    async message(tokens: WorkspaceTokens, id: string): Promise<WorkspaceMessage> {
        if (this.service === 'google_gmail')
            return gmailMessage(await this.read(tokens, `${G}/gmail/v1/users/me/messages/${pathId(id)}?format=full`), true);
        if (this.service === 'microsoft_mail')
            return graphMessage(await this.read(tokens, `${M}/me/messages/${pathId(id)}?$select=id,subject,from,receivedDateTime,bodyPreview,body`), true);
        throw permission();
    }
    async createDraft(tokens: WorkspaceTokens, input: WorkspaceMailInput): Promise<WorkspaceDraft> {
        checkMail(input);
        let row: any;
        if (this.service === 'google_gmail') {
            row = await this.post(tokens, `${G}/gmail/v1/users/me/drafts`, { message: { raw: mailRaw(input) } });
        }
        else if (this.service === 'microsoft_mail')
            row = await this.post(tokens, `${M}/me/messages`, { subject: input.subject, body: { contentType: 'Text', content: input.text }, toRecipients: input.to.map(address => ({ emailAddress: { address } })) });
        else
            throw permission();
        return { id: str(row.id), ...input, revision: str(this.service === 'google_gmail' ? row.message?.id : row.changeKey) };
    }
    async getDraft(tokens: WorkspaceTokens, draftId: string): Promise<WorkspaceDraft> {
        if (this.service === 'google_gmail')
            return gmailDraft(await this.read(tokens, `${G}/gmail/v1/users/me/drafts/${pathId(draftId)}?format=full`));
        if (this.service === 'microsoft_mail')
            return graphDraft(await this.read(tokens, `${M}/me/messages/${pathId(draftId)}?$select=id,changeKey,subject,toRecipients,ccRecipients,bccRecipients,replyTo,body,isDraft,hasAttachments`));
        throw permission();
    }
    async sendDraft(tokens: WorkspaceTokens, draftId: string, reviewed?: WorkspaceMailInput): Promise<{
        id: string;
    }> {
        if (this.service === 'google_gmail')
            return { id: str((await this.post(tokens, `${G}/gmail/v1/users/me/drafts/send`, { id: idInput(draftId), ...(reviewed ? { message: { raw: mailRaw(reviewed) } } : {}) })).id) };
        if (this.service === 'microsoft_mail') {
            await this.post(tokens, `${M}/me/messages/${pathId(draftId)}/send`, {}, deadline(), true);
            return { id: draftId };
        }
        throw permission();
    }
    async events(tokens: WorkspaceTokens, calendarId: string, from: string, to: string): Promise<WorkspacePage<WorkspaceEvent>> {
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
        range(from, to, dateOnly);
        if (dateOnly)
            to = new Date(Date.parse(to) + 86400000).toISOString();
        if (this.service === 'google_calendar') {
            const url = new URL(`${G}/calendar/v3/calendars/${pathId(calendarId)}/events`);
            url.search = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' }).toString();
            return this.googlePage(tokens, url, 'items', googleEvent, 'events:' + calendarId);
        }
        if (this.service === 'microsoft_calendar') {
            const url = new URL(`${M}/me/calendars/${pathId(calendarId)}/calendarView`);
            url.search = new URLSearchParams({ startDateTime: new Date(from).toISOString(), endDateTime: new Date(to).toISOString(), '$top': '100', '$select': 'id,subject,start,end,webLink' }).toString();
            return this.graphPage(tokens, url, graphEvent, 'events:' + calendarId);
        }
        throw permission();
    }
    async publishEvent(tokens: WorkspaceTokens, calendarId: string, input: WorkspaceEventInput): Promise<WorkspaceEvent> {
        checkEvent(input);
        if (this.service === 'google_calendar') {
            const stable = createHash('sha256').update(input.externalKey).digest('hex');
            return googleEvent(await this.post(tokens, `${G}/calendar/v3/calendars/${pathId(calendarId)}/events?sendUpdates=none`, { id: stable, summary: input.title, description: input.description, start: { dateTime: input.start, timeZone: input.timeZone }, end: { dateTime: input.end, timeZone: input.timeZone }, extendedProperties: { private: { prometeusExternalKey: input.externalKey } } }));
        }
        if (this.service === 'microsoft_calendar') {
            const stable = createHash('sha256').update(input.externalKey).digest('hex');
            const utc = (text: string) => ({ dateTime: new Date(text).toISOString().replace('Z', ''), timeZone: 'UTC' });
            return graphEvent(await this.post(tokens, `${M}/me/calendars/${pathId(calendarId)}/events`, { transactionId: stable, subject: input.title, body: { contentType: 'Text', content: input.description }, start: utc(input.start), end: utc(input.end) }));
        }
        throw permission();
    }
    async sheet(tokens: WorkspaceTokens, spreadsheetId: string): Promise<WorkspaceSheet> {
        if (this.service !== 'google_sheets')
            throw permission();
        const signal = deadline();
        const meta = await this.read(tokens, `https://sheets.googleapis.com/v4/spreadsheets/${pathId(spreadsheetId)}?fields=sheets(properties(title,index,gridProperties))`, signal);
        const sheets = array(meta.sheets, 500).map(row => object(row.properties)).sort((a, b) => a.index - b.index);
        const first = sheets[0];
        if (!first)
            throw invalid();
        const name = str(first.title, 500);
        const rows = Number(first.gridProperties?.rowCount);
        const columns = Number(first.gridProperties?.columnCount);
        if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(columns) || columns < 0)
            throw invalid();
        const selected = `'${name.replace(/'/g, "''")}'!A1:AZ501`;
        const body = await this.read(tokens, `https://sheets.googleapis.com/v4/spreadsheets/${pathId(spreadsheetId)}/values/${encodeURIComponent(selected)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, signal);
        const values = array(body.values ?? [], 501).map(row => array(row, 52).map(value => { if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
            throw invalid(); const text = String(value); if (text.length > 10000)
            throw invalid(); return text; }));
        return { name, headers: values[0] ?? [], rows: values.slice(1), truncated: rows > 501 || columns > 52 };
    }
    async searchReport(tokens: WorkspaceTokens, siteId: string, from: string, to: string): Promise<SearchConsoleReport> {
        if (this.service !== 'google_search_console')
            throw permission();
        range(from, to, true);
        const signal = deadline();
        const query = async (dimension?: string) => { const body = await this.post(tokens, `${G}/webmasters/v3/sites/${pathId(siteId)}/searchAnalytics/query`, { startDate: from, endDate: to, type: 'web', dataState: 'final', ...(dimension ? { dimensions: [dimension], rowLimit: dimension === 'date' ? 366 : 100 } : { rowLimit: 1 }) }, signal); return array(body.rows ?? [], dimension === 'date' ? 366 : dimension ? 100 : 1); };
        const metrics = (row: any) => { row = object(row); const metric = (key: string): number => { if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0)
            throw invalid(); return row[key]; }; const ctr = metric('ctr'); if (ctr > 1)
            throw invalid(); return { clicks: metric('clicks'), impressions: metric('impressions'), ctr, position: metric('position') }; };
        const aggregate = await query();
        const daily = await query('date');
        const pages = await query('page');
        const queries = await query('query');
        const key = (row: any) => { if (!Array.isArray(row.keys) || row.keys.length !== 1)
            throw invalid(); return str(row.keys[0], 4000); };
        return { from, to, totals: aggregate[0] ? metrics(aggregate[0]) : null, daily: daily.map(row => ({ date: key(row), ...metrics(row) })), pages: pages.map(row => ({ page: key(row), ...metrics(row) })), queries: queries.map(row => ({ query: key(row), ...metrics(row) })),
            // Search Analytics explicitly exposes top rows and omits anonymized queries.
            // This flag means detail distributions are partial, even below our row cap.
            truncated: true };
    }
}
export function createWorkspaceProviderClient(service: WorkspaceService, config: WorkspaceAppConfig, fetcher: typeof fetch = fetch): WorkspaceProviderClient {
    const client = new WorkspaceClient(service, config, fetcher);
    const api: WorkspaceProviderClient = { authorizationUrl: client.authorizationUrl.bind(client), exchange: client.exchange.bind(client), refresh: client.refresh.bind(client), identity: client.identity.bind(client), resources: client.resources.bind(client), resource: client.resource.bind(client) };
    if (['google_gmail', 'microsoft_mail'].includes(service))
        Object.assign(api, { messages: client.messages.bind(client), message: client.message.bind(client), createDraft: client.createDraft.bind(client), getDraft: client.getDraft.bind(client), sendDraft: client.sendDraft.bind(client) });
    if (['google_calendar', 'microsoft_calendar'].includes(service))
        Object.assign(api, { events: client.events.bind(client), publishEvent: client.publishEvent.bind(client) });
    if (service === 'google_sheets')
        api.sheet = client.sheet.bind(client);
    if (service === 'google_search_console')
        api.searchReport = client.searchReport.bind(client);
    return api;
}
