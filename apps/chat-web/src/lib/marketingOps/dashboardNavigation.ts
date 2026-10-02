import { workspaceServices } from './workspace';
const path = '/marketing-ops/dashboard';
const context = (params: URLSearchParams) => {
  const next = new URLSearchParams();
  for (const name of ['provider', 'from', 'to', 'campaignId']) {
    const value = params.get(name);
    if (value) next.set(name, value);
  }
  return next;
};
export function analyticsDashboardTarget(params: URLSearchParams) {
  const next = context(params);
  next.set('provider', params.get('provider') === 'clarity' ? 'clarity' : 'ga4');
  next.set('tab', 'overview');
  next.set('detail', 'site');
  return `${path}?${next}`;
}
export function workspaceDashboardTarget(params: URLSearchParams) {
  const next = context(params);
  next.delete('provider');
  const service = params.get('service');
  if (service === 'google_search_console') {
    next.set('tab', 'organic');
    next.set('source', 'search');
  } else {
    if (service && Object.prototype.hasOwnProperty.call(workspaceServices, service)) next.set('service', service);
    next.set('tab', 'work');
  }
  return `${path}?${next}`;
}
