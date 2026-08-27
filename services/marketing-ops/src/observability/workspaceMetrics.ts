import type { Pool } from 'pg';
import type { WorkspaceMetricsSnapshot } from '../http/createApp.js';

export async function collectWorkspaceMetrics(pool: Pool): Promise<WorkspaceMetricsSnapshot> {
  const result = await pool.query<{
    campaigns_created: string;
    campaigns_without_owner: string;
    active_users_24h: string;
    briefing_completion_ratio: number;
    time_to_planned_count: string;
    time_to_planned_sum: number;
    status_transitions: WorkspaceMetricsSnapshot['statusTransitions'];
    production_items: WorkspaceMetricsSnapshot['productionItems'];
  }>(`
    with transition_events as (
      select
        aggregate_id as campaign_id,
        payload ->> 'from' as from_status,
        payload ->> 'to' as to_status,
        occurred_at
      from marketing_ops.domain_events
      where aggregate_type = 'campaign'
        and event_type in (
          'marketing_ops.campaign.status_changed.v1',
          'marketing_ops.campaign.archived.v1'
        )
    ),
    first_planned as (
      select campaign_id, min(occurred_at) as planned_at
      from transition_events
      where to_status = 'planned'
      group by campaign_id
    ),
    grouped_transitions as (
      select from_status, to_status, count(*)::int as count
      from transition_events
      group by from_status, to_status
    ),
    grouped_production_items as (
      select status::text as status, kind::text as kind, count(*)::int as count
      from marketing_ops.campaign_items
      group by status, kind
    )
    select
      (select count(*) from marketing_ops.campaigns)::text as campaigns_created,
      (
        select count(*)
        from marketing_ops.campaigns campaign
        where not exists (
          select 1
          from marketing_ops.campaign_members participant
          where participant.campaign_id = campaign.id and participant.is_primary
        )
      )::text as campaigns_without_owner,
      (
        select count(distinct actor_user_id)
        from marketing_ops.audit_events
        where created_at >= now() - interval '24 hours'
      )::text as active_users_24h,
      coalesce((
        select avg((briefing is not null and btrim(briefing) <> '')::int)::double precision
        from marketing_ops.campaigns
        where status <> 'archived'
      ), 0) as briefing_completion_ratio,
      (select count(*) from first_planned)::text as time_to_planned_count,
      coalesce((
        select sum(greatest(extract(epoch from planned.planned_at - campaign.created_at), 0))::double precision
        from first_planned planned
        join marketing_ops.campaigns campaign on campaign.id = planned.campaign_id
      ), 0) as time_to_planned_sum,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'from', from_status,
          'to', to_status,
          'count', count
        ) order by from_status, to_status)
        from grouped_transitions
      ), '[]'::jsonb) as status_transitions,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', status,
          'kind', kind,
          'count', count
        ) order by status, kind)
        from grouped_production_items
      ), '[]'::jsonb) as production_items
  `);
  const row = result.rows[0];
  if (!row) throw new Error('workspace metrics query returned no row');
  return {
    campaignsCreated: Number(row.campaigns_created),
    campaignsWithoutOwner: Number(row.campaigns_without_owner),
    activeUsers24h: Number(row.active_users_24h),
    briefingCompletionRatio: Number(row.briefing_completion_ratio),
    timeToPlannedSeconds: {
      count: Number(row.time_to_planned_count),
      sum: Number(row.time_to_planned_sum)
    },
    statusTransitions: row.status_transitions,
    productionItems: row.production_items
  };
}
