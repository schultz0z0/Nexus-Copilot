import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import type { CommandContext } from './context.js';

export interface LeadResultFilters { campaignId?: string | undefined; from?: string | undefined; to?: string | undefined }
type Metrics = { qualified: number | null; sales: number | null; revenue: number | null; spend: number | null };
export interface LeadResults extends Metrics {
  contactsCold: number; capturedLeads: number; whatsappClicks: number;
  weekly: Array<{ week: string; leads: number }>;
  channels: Array<{ channel: string; leads: number }>;
  campaigns: Array<Metrics & { id: string; name: string; contactsCold: number; capturedLeads: number }>;
  coverage: { sources: number; reports: number; partialReportsExcluded: number; metricReports: Record<keyof Metrics, number> };
  lastUpdated: string | null;
}
const metricKeys = ['qualified', 'sales', 'revenue', 'spend'] as const;
const emptyMetrics = (): Metrics => ({ qualified: null, sales: null, revenue: null, spend: null });
const peopleCte = `with links as (
  select link.*,source.channel from marketing_ops.campaign_leads link
  join marketing_ops.campaigns campaign on campaign.id=link.campaign_id
  join marketing_ops.lead_sources source on source.id=coalesce(link.captured_source_id,link.first_source_id)
  where ($1::uuid is null or link.campaign_id=$1) and campaign.status <> 'archived'
), captured as (
  select distinct on(contact_id) contact_id,captured_at,channel from links where classification='lead' order by contact_id,captured_at,campaign_id
), period_captured as (
  select * from captured where ($2::date is null or captured_at >= $2::date::timestamp at time zone 'America/Sao_Paulo') and ($3::date is null or captured_at < ($3::date+1)::timestamp at time zone 'America/Sao_Paulo')
)`;

export async function getLeadResults(context: CommandContext, filters: LeadResultFilters): Promise<LeadResults> {
  authorize(context.actor, 'campaign.read');
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    if (filters.campaignId) {
      const found = await client.query('select id from marketing_ops.campaigns where id=$1 and marketing_ops_private.can_access_campaign(id)', [filters.campaignId]);
      if (!found.rows[0]) throw appError('not_found', 404, 'Campaign not found');
    }
    const args = [filters.campaignId ?? null, filters.from ?? null, filters.to ?? null];
    const totals = await client.query(`${peopleCte} select (select count(*) from period_captured) as captured,
      (select count(distinct contact_id) from links where classification='cold' and not exists(select 1 from captured where captured.contact_id=links.contact_id)
        and ($2::date is null or first_occurred_at >= $2::date::timestamp at time zone 'America/Sao_Paulo') and ($3::date is null or first_occurred_at < ($3::date+1)::timestamp at time zone 'America/Sao_Paulo')) as cold`, args);
    const weeks = await client.query(`${peopleCte} select to_char(date_trunc('week',captured_at at time zone 'America/Sao_Paulo'),'YYYY-MM-DD') as week,count(*) as leads from period_captured group by 1 order by 1`, args);
    const channels = await client.query(`${peopleCte} select channel,count(*) as leads from period_captured group by channel order by leads desc,channel`, args);
    const campaigns = await client.query(`select campaign.id,campaign.name,
      count(distinct link.contact_id) filter(where link.classification='lead' and ($2::date is null or link.captured_at >= $2::date::timestamp at time zone 'America/Sao_Paulo') and ($3::date is null or link.captured_at < ($3::date+1)::timestamp at time zone 'America/Sao_Paulo')) as captured,
      count(distinct link.contact_id) filter(where link.classification='cold' and ($2::date is null or link.first_occurred_at >= $2::date::timestamp at time zone 'America/Sao_Paulo') and ($3::date is null or link.first_occurred_at < ($3::date+1)::timestamp at time zone 'America/Sao_Paulo')) as cold
      from marketing_ops.campaigns campaign left join marketing_ops.campaign_leads link on link.campaign_id=campaign.id
      where ($1::uuid is null or campaign.id=$1) and campaign.status <> 'archived' and marketing_ops_private.can_access_campaign(campaign.id)
      group by campaign.id,campaign.name order by campaign.created_at desc,campaign.id`, args);
    const reports = await client.query(`select report.campaign_id,
      sum((metrics->>'qualified')::numeric) as qualified,sum((metrics->>'sales')::numeric) as sales,
      sum((metrics->>'revenue')::numeric) as revenue,sum((metrics->>'spend')::numeric) as spend,
      count(*) as reports,count(*) filter(where metrics ? 'qualified') as qualified_reports,count(*) filter(where metrics ? 'sales') as sales_reports,
      count(*) filter(where metrics ? 'revenue') as revenue_reports,count(*) filter(where metrics ? 'spend') as spend_reports
      from marketing_ops.result_reports report join marketing_ops.campaigns campaign on campaign.id=report.campaign_id
      where report.ads_active and ($1::uuid is null or report.campaign_id=$1) and campaign.status <> 'archived'
        and ($2::date is null or report.period_from >= $2::date) and ($3::date is null or report.period_to <= $3::date)
      group by report.campaign_id`, args);
    const coverage = await client.query(`select
      (select count(*) from marketing_ops.lead_sources source join marketing_ops.campaigns campaign on campaign.id=source.campaign_id where ($1::uuid is null or source.campaign_id=$1) and campaign.status <> 'archived') as sources,
      (select count(*) from marketing_ops.result_reports report join marketing_ops.campaigns campaign on campaign.id=report.campaign_id where report.ads_active and ($1::uuid is null or report.campaign_id=$1) and campaign.status <> 'archived'
        and ($2::date is null or report.period_to >= $2::date) and ($3::date is null or report.period_from <= $3::date)
        and (($2::date is not null and report.period_from < $2::date) or ($3::date is not null and report.period_to > $3::date))) as excluded,
      (select count(*) from marketing_ops.lead_receipts receipt join marketing_ops.campaigns campaign on campaign.id=receipt.campaign_id where receipt.kind='whatsapp_click' and ($1::uuid is null or receipt.campaign_id=$1) and campaign.status <> 'archived'
        and ($2::date is null or receipt.occurred_at >= $2::date::timestamp at time zone 'America/Sao_Paulo') and ($3::date is null or receipt.occurred_at < ($3::date+1)::timestamp at time zone 'America/Sao_Paulo')) as clicks,
      (select max(updated) from (
        select source.updated_at as updated from marketing_ops.lead_sources source join marketing_ops.campaigns campaign on campaign.id=source.campaign_id where ($1::uuid is null or source.campaign_id=$1) and campaign.status <> 'archived'
        union all select link.updated_at from marketing_ops.campaign_leads link join marketing_ops.campaigns campaign on campaign.id=link.campaign_id where ($1::uuid is null or link.campaign_id=$1) and campaign.status <> 'archived'
        union all select report.updated_at from marketing_ops.result_reports report join marketing_ops.campaigns campaign on campaign.id=report.campaign_id where report.ads_active and ($1::uuid is null or report.campaign_id=$1) and campaign.status <> 'archived'
      ) updates) as updated`, args);
    const metrics = emptyMetrics();
    const metricReports: Record<keyof Metrics, number> = { qualified: 0, sales: 0, revenue: 0, spend: 0 };
    for (const report of reports.rows) for (const key of metricKeys) {
      if (report[key] !== null && report[key] !== undefined) metrics[key] = (metrics[key] ?? 0) + Number(report[key]);
      metricReports[key] += Number(report[`${key}_reports`] ?? 0);
    }
    return {
      ...metrics, contactsCold: Number(totals.rows[0]?.cold ?? 0), capturedLeads: Number(totals.rows[0]?.captured ?? 0), whatsappClicks: Number(coverage.rows[0]?.clicks ?? 0),
      weekly: weeks.rows.map(row => ({ week: row.week, leads: Number(row.leads) })), channels: channels.rows.map(row => ({ channel: row.channel, leads: Number(row.leads) })),
      campaigns: campaigns.rows.map(row => { const report = reports.rows.find(report => report.campaign_id === row.id); return { id: row.id, name: row.name, contactsCold: Number(row.cold), capturedLeads: Number(row.captured), ...Object.fromEntries(metricKeys.map(key => [key, report?.[key] == null ? null : Number(report[key])])) } as LeadResults['campaigns'][number]; }),
      coverage: { sources: Number(coverage.rows[0]?.sources ?? 0), reports: reports.rows.reduce((total, report) => total + Number(report.reports), 0), partialReportsExcluded: Number(coverage.rows[0]?.excluded ?? 0), metricReports },
      lastUpdated: coverage.rows[0]?.updated ? new Date(coverage.rows[0].updated).toISOString() : null
    };
  });
}
