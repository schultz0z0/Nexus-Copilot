import { supabase } from '@/lib/supabase';
import { createMarketingOpsClient } from './client';

export const marketingOpsClient = createMarketingOpsClient({
  baseUrl: import.meta.env.VITE_MARKETING_OPS_URL ?? '',
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
});
