import { Navigate, useSearchParams } from 'react-router-dom';
import { analyticsDashboardTarget } from '@/lib/marketingOps/dashboardNavigation';

/** Preserve existing bookmarks while keeping all site analysis in the dashboard. */
export default function WebAnalyticsPage() {
  const [params] = useSearchParams();
  return <Navigate replace to={analyticsDashboardTarget(params)} />;
}
