export const workspaceServices = ['google_drive', 'google_gmail', 'google_calendar', 'google_sheets', 'google_search_console', 'microsoft_files', 'microsoft_mail', 'microsoft_calendar'] as const;
export type WorkspaceService = typeof workspaceServices[number];
export type WorkspaceFamily = 'google' | 'microsoft';
export interface WorkspaceAppConfig { clientId: string; clientSecret: string; redirectUri: string; tenantId?: string }
export interface WorkspaceTokens { accessToken: string; refreshToken?: string; expiresAt?: string; scopes: string[] }
export interface WorkspaceIdentity { id: string; email: string; name: string }
export interface WorkspaceResource { id: string; name: string; kind: 'folder' | 'file' | 'spreadsheet' | 'calendar' | 'mailbox' | 'site'; url: string | null; mimeType?: string; parentId?: string; writable?: boolean }
export interface WorkspacePage<T> { items: T[]; nextPage: string | null; truncated: boolean }
export interface WorkspaceMessage { id: string; subject: string; from: string; receivedAt: string; snippet: string; text?: string }
export interface WorkspaceMailInput { to: string[]; subject: string; text: string }
export interface WorkspaceDraft { id: string; subject: string; to: string[]; text: string; revision?: string }
export interface WorkspaceEventInput { title: string; description: string; start: string; end: string; timeZone: string; externalKey: string }
export interface WorkspaceEvent { id: string; title: string; start: string; end: string; url: string | null }
export interface WorkspaceSheet { name: string; headers: string[]; rows: string[][]; truncated: boolean }
export interface SearchConsoleReport { from: string; to: string; totals: { clicks: number; impressions: number; ctr: number; position: number } | null; daily: { date: string; clicks: number; impressions: number; ctr: number; position: number }[]; pages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[]; queries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[]; truncated: boolean }
export interface WorkspaceProviderClient {
  authorizationUrl(state: string, verifier: string): string;
  exchange(code: string, verifier: string): Promise<WorkspaceTokens>;
  refresh(tokens: WorkspaceTokens): Promise<WorkspaceTokens>;
  identity(tokens: WorkspaceTokens): Promise<WorkspaceIdentity>;
  resources(tokens: WorkspaceTokens, options?: { parentId?: string; search?: string; page?: string }): Promise<WorkspacePage<WorkspaceResource>>;
  resource(tokens: WorkspaceTokens, id: string): Promise<WorkspaceResource>;
  messages?(tokens: WorkspaceTokens, resourceId: string): Promise<WorkspacePage<WorkspaceMessage>>;
  message?(tokens: WorkspaceTokens, id: string): Promise<WorkspaceMessage>;
  createDraft?(tokens: WorkspaceTokens, input: WorkspaceMailInput): Promise<WorkspaceDraft>;
  getDraft?(tokens: WorkspaceTokens, draftId: string): Promise<WorkspaceDraft>;
  sendDraft?(tokens: WorkspaceTokens, draftId: string, reviewed?: WorkspaceMailInput): Promise<{ id: string }>;
  events?(tokens: WorkspaceTokens, calendarId: string, from: string, to: string): Promise<WorkspacePage<WorkspaceEvent>>;
  publishEvent?(tokens: WorkspaceTokens, calendarId: string, input: WorkspaceEventInput): Promise<WorkspaceEvent>;
  sheet?(tokens: WorkspaceTokens, spreadsheetId: string): Promise<WorkspaceSheet>;
  searchReport?(tokens: WorkspaceTokens, siteId: string, from: string, to: string): Promise<SearchConsoleReport>;
}
export const workspaceFamily = (service: WorkspaceService): WorkspaceFamily => service.startsWith('google_') ? 'google' : 'microsoft';
