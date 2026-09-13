import { createMarketingOpsClient } from './client';

export const marketingOpsClient = createMarketingOpsClient({
  baseUrl: '/api/marketing',
});
