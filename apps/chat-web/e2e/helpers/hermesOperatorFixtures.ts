export const USER = '11111111-1111-4111-8111-111111111111';
export const SESSION = '22222222-2222-4222-8222-222222222222';
export const RUN_PLAN = '33333333-3333-4333-8333-333333333333';
export const RUN_EXECUTE = '44444444-4444-4444-8444-444444444444';
export const RUN_UNAVAILABLE = '55555555-5555-4555-8555-555555555555';
export const CAMPAIGN = '66666666-6666-4666-8666-666666666666';
export const ITEM = '77777777-7777-4777-8777-777777777777';
export const ASSET = '88888888-8888-4888-8888-888888888888';
export const now = '2026-07-22T12:00:00.000Z';

export const campaign = {
  id: CAMPAIGN,
  tenantId: 'ens',
  name: 'Campanha Pós 2026',
  courseSlug: 'pos-graduacao-ens',
  objective: 'Gerar matrículas',
  referenceType: null,
  referenceKey: null,
  referenceTitleSnapshot: null,
  referenceDocumentId: null,
  referenceVerifiedAt: null,
  audience: 'Corretores e gestores',
  startsOn: '2026-08-01',
  endsOn: '2026-08-20',
  primaryChannel: 'email',
  secondaryChannels: [],
  briefing: null,
  notes: null,
  status: 'draft',
  version: 1,
  createdBy: USER,
  updatedBy: USER,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  responsibles: [],
  attention: [],
};

export const item = {
  id: ITEM,
  tenantId: 'ens',
  campaignId: CAMPAIGN,
  campaignName: 'Campanha Pós 2026',
  kind: 'email',
  title: 'Email de boas-vindas',
  content: null,
  status: 'draft',
  assigneeUserId: USER,
  priority: 'high',
  channel: 'email',
  description: 'Checklist inicial criado pelo Hermes.',
  startsAt: '2026-08-02T13:00:00.000Z',
  dueAt: '2026-08-02T15:00:00.000Z',
  metadata: {},
  version: 1,
  createdBy: USER,
  updatedBy: USER,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  cancelledAt: null,
  effectiveAt: '2026-08-02T13:00:00.000Z',
  isOverdue: false,
  isBlocked: false,
};

export const asset = {
  id: ASSET,
  itemId: ITEM,
  campaignId: CAMPAIGN,
  assetKind: 'copy',
  title: 'Copy principal',
  currentVersionNumber: 1,
  version: 1,
  createdBy: USER,
  updatedBy: USER,
  createdAt: now,
  updatedAt: now,
};

export const planMessage = [
  'Plano pronto para confirmar.',
  '',
  '- Criar campanha em rascunho "Campanha Pós 2026".',
  '- Criar item "Email de boas-vindas".',
  '- Salvar a copy "Copy principal" como versão vinculada.',
  '',
  'Se estiver certo, responda apenas `aprovado`.',
].join('\n');

export const successMessage = [
  'Operação concluída no Marketing Ops.',
  '',
  '- Campanha criada em rascunho.',
  '- Item criado com a copy vinculada.',
  '',
  `[Abrir item e conteúdo](/marketing-ops/production/items/${ITEM}?contentAssetId=${ASSET})`,
].join('\n');

export const unavailableMessage = [
  'Não consegui consultar o Marketing Ops agora.',
  'Nenhuma alteração foi persistida.',
  'Tente novamente em alguns instantes.',
].join('\n\n');
