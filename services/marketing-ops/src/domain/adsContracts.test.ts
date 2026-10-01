import { describe,expect,it } from 'vitest';
import { adsSyncPeriod } from './adsContracts.js';
describe('account-local Ads backfill',()=>{
  it('uses the last seven closed account days around UTC midnight',()=>{
    const now=Date.parse('2026-09-30T01:00:00Z');
    expect(adsSyncPeriod('America/Sao_Paulo',now)).toEqual({from:'2026-09-22',to:'2026-09-28'});
    expect(adsSyncPeriod('Pacific/Auckland',now)).toEqual({from:'2026-09-23',to:'2026-09-29'});
  });
});
