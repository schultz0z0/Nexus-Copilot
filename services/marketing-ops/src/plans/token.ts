import { randomUUID } from 'node:crypto';
import { decodeProtectedHeader, errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod/v4';
import type { DelegationKeyring } from '../delegation/claims.js';
import type { DelegatedActor } from '../delegation/verifier.js';
import { AppError, appError } from '../errors.js';
import { hashCanonicalPayload } from '../domain/hash.js';
import { marketingOpsPlanActionsSchema, type MarketingOpsPlanAction } from './contracts.js';

const PLAN_ISSUER = 'nexus-marketing-ops';
const PLAN_AUDIENCE = 'nexus-marketing-ops-plan';
const MAX_PLAN_TTL_SECONDS = 1800;

const planClaimsSchema = z.object({
  plan_id: z.string().uuid(),
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/),
  sub: z.string().uuid(),
  tenant_id: z.string().uuid(),
  chat_session_id: z.string().uuid(),
  prepared_jti: z.string().min(8),
  actions: marketingOpsPlanActionsSchema,
  contract_version: z.literal(1),
  iat: z.number().int(),
  nbf: z.number().int(),
  exp: z.number().int()
});

export type MarketingOpsPlan = z.infer<typeof planClaimsSchema>;

interface PlanTimeOptions { now?: number; ttlSeconds?: number }

export async function issueMarketingOpsPlan(
  actor: DelegatedActor,
  inputActions: MarketingOpsPlanAction[],
  keyring: DelegationKeyring,
  options: PlanTimeOptions = {}
): Promise<{ token: string; planId: string; planHash: string; expiresAt: number; actions: MarketingOpsPlanAction[] }> {
  const actions = marketingOpsPlanActionsSchema.parse(inputActions);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(60, Math.min(MAX_PLAN_TTL_SECONDS, options.ttlSeconds ?? 900));
  const planId = randomUUID();
  const planHash = hashCanonicalPayload(actions);
  const expiresAt = now + ttlSeconds;
  const token = await new SignJWT({
    plan_id: planId,
    plan_hash: planHash,
    tenant_id: actor.tenantId,
    chat_session_id: actor.chatSessionId,
    prepared_jti: actor.jti,
    actions,
    contract_version: 1
  })
    .setProtectedHeader({ alg: 'HS256', kid: keyring.activeKid })
    .setIssuer(PLAN_ISSUER)
    .setAudience(PLAN_AUDIENCE)
    .setSubject(actor.userId)
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(keyring.activeKey));
  return { token, planId, planHash, expiresAt, actions };
}

export async function verifyMarketingOpsPlan(
  token: string,
  actor: DelegatedActor,
  keyring: DelegationKeyring,
  options: Pick<PlanTimeOptions, 'now'> = {}
): Promise<MarketingOpsPlan> {
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'HS256' || typeof header.kid !== 'string') throw appError('plan_invalid', 401, 'Plan header is invalid');
    const rawKey = header.kid === keyring.activeKid
      ? keyring.activeKey
      : header.kid === keyring.previousKid
        ? keyring.previousKey
        : undefined;
    if (!rawKey) throw appError('plan_invalid', 401, 'Plan key id is unknown');
    const verified = await jwtVerify(token, new TextEncoder().encode(rawKey), {
      algorithms: ['HS256'],
      issuer: PLAN_ISSUER,
      audience: PLAN_AUDIENCE,
      requiredClaims: ['sub', 'iat', 'nbf', 'exp'],
      clockTolerance: 2,
      ...(options.now === undefined ? {} : { currentDate: new Date(options.now * 1000) })
    });
    const plan = planClaimsSchema.parse(verified.payload);
    if (plan.exp <= plan.iat || plan.exp - plan.iat > MAX_PLAN_TTL_SECONDS) {
      throw appError('plan_invalid', 401, 'Plan lifetime is invalid');
    }
    if (
      plan.sub !== actor.userId ||
      plan.tenant_id !== actor.tenantId ||
      plan.chat_session_id !== actor.chatSessionId ||
      plan.plan_hash !== hashCanonicalPayload(plan.actions)
    ) {
      throw appError('plan_invalid', 403, 'Plan does not belong to this actor and session');
    }
    if (!actor.confirmationIntent || actor.jti === plan.prepared_jti) {
      throw appError('confirmation_required', 409, 'A later explicit user confirmation is required');
    }
    return plan;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof joseErrors.JWTExpired) throw appError('plan_expired', 410, 'Plan expired and must be prepared again');
    throw appError('plan_invalid', 401, 'Plan is invalid');
  }
}
