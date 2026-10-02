import { expect, it } from 'vitest';
import { analyticsDashboardTarget, workspaceDashboardTarget } from './dashboardNavigation';
it('routes legacy site results into the dashboard detail and preserves dates', () => {
  const target = analyticsDashboardTarget(new URLSearchParams('provider=clarity&from=2026-09-01&to=2026-09-07'));
  expect(target).toBe('/marketing-ops/dashboard?provider=clarity&from=2026-09-01&to=2026-09-07&tab=overview&detail=site');
});
it('routes Search Console to organic and work services to the embedded workspace', () => {
  expect(workspaceDashboardTarget(new URLSearchParams('service=google_search_console'))).toBe('/marketing-ops/dashboard?tab=organic&source=search');
  expect(workspaceDashboardTarget(new URLSearchParams('service=google_sheets'))).toBe('/marketing-ops/dashboard?service=google_sheets&tab=work');
});
