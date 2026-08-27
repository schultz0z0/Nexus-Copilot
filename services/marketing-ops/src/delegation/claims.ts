import { z } from 'zod';

export const delegationClaimsSchema = z.object({
  sub: z.string().uuid(),
  tenant_id: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/i),
  actor_role: z.enum(['member', 'manager', 'admin']),
  scopes: z.array(z.string().min(1)).min(1),
  chat_session_id: z.string().uuid(),
  run_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  confirmation_intent: z.boolean().optional().default(false),
  jti: z.string().min(8),
  iat: z.number().int(),
  nbf: z.number().int(),
  exp: z.number().int(),
  contract_version: z.literal(1)
});

export type DelegationClaims = z.infer<typeof delegationClaimsSchema>;
export interface DelegationKeyring {
  activeKid: string; activeKey: string; previousKid?: string; previousKey?: string;
  issuer: string; audience: string; maxTtlSeconds: number;
}
