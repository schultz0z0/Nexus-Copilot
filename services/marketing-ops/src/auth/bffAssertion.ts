import { decodeProtectedHeader, jwtVerify } from 'jose';
import { z } from 'zod';
import { appError } from '../errors.js';

export interface BffAssertionConfig {
  activeKid: string;
  activeKey: string;
  previousKid?: string;
  previousKey?: string;
  issuer: string;
  audience: string;
  maxTtlSeconds: number;
}

export interface BffActorClaims {
  userId: string;
  tenantId: string;
  role: 'member' | 'manager' | 'admin';
  correlationId: string;
  jti: string;
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  tenant_id: z.string().uuid(),
  actor_role: z.enum(['member', 'manager', 'admin']),
  correlation_id: z.string().uuid(),
  method: z.string().regex(/^[A-Z]+$/),
  path: z.string().startsWith('/').refine((value) => !value.includes('?')),
  iss: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number().int(), nbf: z.number().int(), exp: z.number().int(),
  jti: z.string().uuid()
});

const invalidAssertion = () => appError('unauthorized', 401, 'Invalid BFF actor assertion');

export async function verifyBffAssertion(
  token: string,
  expectedMethod: string,
  expectedPath: string,
  config: BffAssertionConfig,
  now = new Date()
): Promise<BffActorClaims> {
  try {
    if (!token || config.maxTtlSeconds < 1 || config.maxTtlSeconds > 30) throw new Error('invalid');
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || typeof header.kid !== 'string') throw new Error('invalid');
    let secret: string | undefined;
    if (header.kid === config.activeKid) secret = config.activeKey;
    else if (header.kid === config.previousKid) secret = config.previousKey;
    if (!secret || new TextEncoder().encode(secret).byteLength < 32) throw new Error('invalid');
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'], issuer: config.issuer, audience: config.audience,
      currentDate: now, clockTolerance: 0
    });
    const claims = claimsSchema.parse(verified.payload);
    if (claims.exp - claims.iat > config.maxTtlSeconds || claims.exp <= claims.iat) throw new Error('invalid');
    if (claims.method !== expectedMethod.toUpperCase() || claims.path !== expectedPath) throw new Error('invalid');
    return {
      userId: claims.sub, tenantId: claims.tenant_id, role: claims.actor_role,
      correlationId: claims.correlation_id, jti: claims.jti
    };
  } catch {
    throw invalidAssertion();
  }
}
