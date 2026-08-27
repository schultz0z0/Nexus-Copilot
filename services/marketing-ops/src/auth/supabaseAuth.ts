import { z } from 'zod';
import { appError } from '../errors.js';

const userSchema = z.object({ id: z.string().uuid(), email: z.string().email().nullable().optional() });
export interface SupabaseUser { id: string; email: string | null }

export interface SupabaseAuthDependencies {
  supabaseUrl: string;
  anonKey: string;
  fetch?: typeof globalThis.fetch;
}

export async function verifySupabaseBearer(token: string, deps: SupabaseAuthDependencies): Promise<SupabaseUser> {
  const normalized = token.trim();
  if (!normalized) throw appError('unauthorized', 401, 'Bearer token is required');
  let response: Response;
  try {
    response = await (deps.fetch ?? globalThis.fetch)(`${deps.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${normalized}`, apikey: deps.anonKey },
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw appError('auth_unavailable', 503, 'Authentication service is unavailable');
  }
  if (!response.ok) throw appError('unauthorized', 401, 'Bearer token is invalid or expired');
  const parsed = userSchema.safeParse(await response.json());
  if (!parsed.success) throw appError('unauthorized', 401, 'Authentication response is invalid');
  return { id: parsed.data.id, email: parsed.data.email ?? null };
}
