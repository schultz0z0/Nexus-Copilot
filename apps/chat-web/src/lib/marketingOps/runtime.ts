import { api } from '@/lib/api';
import { createMarketingOpsClient } from './client';

export const marketingOpsClient = createMarketingOpsClient({
  baseUrl: import.meta.env.VITE_MARKETING_OPS_URL ?? '',
  getAccessToken: async () => {
    try {
      const { user } = await api.auth.me();
      return user?.id ?? null;
    } catch {
      return null;
    }
  },
});
