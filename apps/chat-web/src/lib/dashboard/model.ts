/** Local demonstration only. No API reads, persistence or production integration. */
export const CHANNELS = [
  { id: 'google', name: 'Google Ads', paid: true, kind: 'Mídia paga', leadBase: 62, quality: .42, spend: 960 },
  { id: 'meta', name: 'Meta Ads', paid: true, kind: 'Mídia paga', leadBase: 91, quality: .31, spend: 810 },
  { id: 'linkedin', name: 'LinkedIn Ads', paid: true, kind: 'Mídia paga', leadBase: 24, quality: .58, spend: 720 },
  { id: 'organic', name: 'Orgânico', paid: false, kind: 'Conteúdo e site', leadBase: 47, quality: .45, spend: 0 },
  { id: 'email', name: 'E-mail', paid: false, kind: 'Informe semanal', leadBase: 28, quality: .5, spend: 0 },
  { id: 'whatsapp', name: 'WhatsApp', paid: false, kind: 'Informe semanal', leadBase: 36, quality: .55, spend: 0 },
] as const;
export type ChannelId = typeof CHANNELS[number]['id'];
export const CAMPAIGNS = [
  { id: 'growth', name: 'Crescimento B2B', objective: 'Gerar oportunidades comerciais', owner: 'Marina Costa', initials: 'MC', weight: 1 },
  { id: 'launch', name: 'Lançamento de solução', objective: 'Apresentar a nova oferta', owner: 'Rafael Lima', initials: 'RL', weight: .62 },
  { id: 'relationship', name: 'Relacionamento e reativação', objective: 'Reativar contatos da base', owner: 'Ana Souza', initials: 'AS', weight: .38 },
] as const;
export type CampaignId = typeof CAMPAIGNS[number]['id'];
export type Filters = { weeks: 1 | 2 | 4; channel: ChannelId | 'all'; campaign: CampaignId | 'all'; unavailable?: boolean };
export type Metrics = { leads: number; qualified: number; opportunities: number; proposals: number; won: number; sales: number; revenue: number; spend: number; goal: number; sent: number; delivered: number; interactions: number; impressions: number; clicks: number };
type Row = Metrics & { week: number; channel: ChannelId; campaign: CampaignId };
const WEEK_LABELS = ['27 jul', '03 ago', '10 ago', '17 ago', '24 ago', '31 ago', '07 set', '14 set'];
export const PERIODS = { 1: '14–20 set 2026', 2: '07–20 set 2026', 4: '24 ago–20 set 2026' } as const;
export const SNAPSHOT = '21 set 2026, 09:00';
const zero = (): Metrics => ({ leads: 0, qualified: 0, opportunities: 0, proposals: 0, won: 0, sales: 0, revenue: 0, spend: 0, goal: 0, sent: 0, delivered: 0, interactions: 0, impressions: 0, clicks: 0 });
function sum(rows: Metrics[]): Metrics {
  return rows.reduce((total, row) => {
    for (const key of Object.keys(total) as Array<keyof Metrics>) total[key] += row[key];
    return total;
  }, zero());
}
const plannedRows: Row[] = Array.from({ length: 8 }, (_, week) => CHANNELS.flatMap((channel, index) => CAMPAIGNS.map((campaign) => {
  const factor = [.82, .88, .9, .94, 1.02, 1.08, 1.14, 1.2][week];
  const leads = Math.round(channel.leadBase * campaign.weight * factor);
  const qualified = Math.round(leads * channel.quality);
  const opportunities = Math.round(qualified * .59);
  const proposals = Math.round(opportunities * .66);
  const won = Math.round(proposals * .43);
  const sales = Math.max(1, won + (week % 2 ? 2 : 1));
  const manual = channel.id === 'email' || channel.id === 'whatsapp';
  const sent = manual ? leads * (channel.id === 'email' ? 40 : 22) : 0;
  return { week, channel: channel.id, campaign: campaign.id, leads, qualified, opportunities, proposals, won, sales,
    sent, delivered: Math.floor(sent * (channel.id === 'email' ? .96 : .92)), interactions: manual ? leads * (channel.id === 'email' ? 4 : 3) : 0,
    impressions: manual ? 0 : leads * (channel.paid ? 200 : 230), clicks: manual ? 0 : leads * (channel.paid ? 10 : 6),
    revenue: sales * (1800 + index * 250), spend: Math.round(channel.spend * campaign.weight * factor),
    goal: Math.round(channel.leadBase * campaign.weight * 1.17) };
}))).flat();
// Last WhatsApp report is absent, not zero. This makes the coverage state demonstrable.
const observedRows = plannedRows.filter(row => !(row.channel === 'whatsapp' && row.week === 7));
export function compare(current: number, previous: number): number | null { return previous === 0 ? null : ((current - previous) / previous) * 100; }
export function rate(numerator: number, denominator: number): number | null { return denominator > 0 ? numerator / denominator * 100 : null; }
export const number = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
export const money = (value: number, digits = 0) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
export const percent = (value: number | null) => value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function buildDashboard(filters: Filters) {
  const matches = (row: Row) => (filters.channel === 'all' || row.channel === filters.channel) && (filters.campaign === 'all' || row.campaign === filters.campaign);
  const start = 8 - filters.weeks;
  const rows = filters.unavailable ? [] : observedRows.filter(matches);
  const currentRows = rows.filter(row => row.week >= start);
  const previousRows = rows.filter(row => row.week >= start - filters.weeks && row.week < start);
  const current = sum(currentRows), previous = sum(previousRows);
  const expected = plannedRows.filter(row => matches(row) && row.week >= start);
  const goal = sum(expected).goal;
  const available = currentRows.length > 0;
  const complete = available && currentRows.length === expected.length;
  const channels = CHANNELS.filter(channel => filters.channel === 'all' || filters.channel === channel.id).map(channel => {
    const scoped = currentRows.filter(row => row.channel === channel.id);
    return { ...channel, name: channel.id === 'linkedin' ? 'LinkedIn Ads' : channel.name, ...sum(scoped), available: scoped.length > 0,
      complete: scoped.length === expected.filter(row => row.channel === channel.id).length,
      updatedAt: filters.unavailable ? null : channel.id === 'whatsapp' ? '14 set, 09:00' : channel.id === 'email' ? '21 set, 08:30' : '21 set, 09:00' };
  });
  const paidQualified = channels.filter(channel => channel.paid).reduce((total, row) => total + row.qualified, 0);
  const campaigns = CAMPAIGNS.filter(campaign => filters.campaign === 'all' || filters.campaign === campaign.id).map(campaign => {
    const scoped = currentRows.filter(row => row.campaign === campaign.id);
    return { ...campaign, ...sum(scoped), available: scoped.length > 0 };
  });
  const trend = Array.from({ length: filters.weeks }, (_, index) => {
    const week = start + index;
    const observed = currentRows.filter(row => row.week === week);
    const baseline = previousRows.filter(row => row.week === week - filters.weeks);
    return { label: WEEK_LABELS[week], ...sum(observed),
      leads: observed.length ? sum(observed).leads : null,
      complete: observed.length === expected.filter(row => row.week === week).length,
      previousLeads: baseline.length ? sum(baseline).leads : null };
  });
  return { available, complete, current, previous, channels, campaigns, trend, goal, paidQualified,
    costPerQualified: available && paidQualified > 0 ? current.spend / paidQualified : null,
    resultHealth: !available ? 'unavailable' : !complete ? 'partial' : current.leads >= goal ? 'on-track' : 'attention',
  };
}

export type WeeklyReport = { from: string; to: string; sent: number; delivered: number; responses: number };
export function validateWeeklyReport(report: WeeklyReport): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = (value: string) => iso.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(report.from) || !validDate(report.to) || report.from > report.to) return 'Informe um período válido, com início anterior ou igual ao fim.';
  if ([report.sent, report.delivered, report.responses].some(value => !Number.isSafeInteger(value) || value < 0)) return 'Informe contagens inteiras, não negativas e sem campos vazios.';
  if (report.delivered > report.sent) return 'As entregas não podem superar os envios.';
  if (report.responses > report.delivered) return 'As interações únicas não podem superar as entregas.';
  return null;
}
