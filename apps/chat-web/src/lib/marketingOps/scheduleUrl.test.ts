import { describe, expect, it } from 'vitest';
import {
  hasProductionScheduleFilters,
  productionScheduleFiltersFrom,
  setProductionScheduleFilter
} from './scheduleUrl';

describe('production schedule URL state', () => {
  it('parses only allowlisted filters and always applies the bounded page size', () => {
    const params = new URLSearchParams({
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'email',
      channel: 'whatsapp',
      assigneeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'ready',
      priority: 'urgent',
      limit: '999',
      cursor: 'not-public-url-state',
      unknown: 'discarded'
    });

    expect(productionScheduleFiltersFrom(params)).toEqual({
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'email',
      channel: 'whatsapp',
      assigneeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'ready',
      priority: 'urgent',
      limit: 25
    });
  });

  it('fails closed for invalid enum and UUID values', () => {
    expect(productionScheduleFiltersFrom(new URLSearchParams({
      campaignId: 'not-a-uuid',
      assigneeId: 'also-invalid',
      kind: 'newsletter',
      channel: 'sms',
      status: 'approved',
      priority: 'critical'
    }))).toEqual({ limit: 25 });
  });

  it('updates one filter without losing the others and removes empty values', () => {
    const initial = new URLSearchParams('status=ready&priority=high');
    const changed = setProductionScheduleFilter(initial, 'kind', 'creative');
    const cleared = setProductionScheduleFilter(changed, 'status');

    expect(changed.toString()).toBe('status=ready&priority=high&kind=creative');
    expect(cleared.toString()).toBe('priority=high&kind=creative');
    expect(hasProductionScheduleFilters(cleared)).toBe(true);
    expect(hasProductionScheduleFilters(new URLSearchParams('view=list'))).toBe(false);
  });
});
