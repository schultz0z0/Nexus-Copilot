import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { resolveActor, type Actor } from '../auth/actor.js';
import { AppError, appError } from '../errors.js';
import type { BffActorClaims } from '../auth/bffAssertion.js';

declare global {
  namespace Express { interface Request { actor?: Actor } }
}

export type AsyncRoute = (request: Request, response: Response, next: NextFunction) => Promise<void>;
export const asyncRoute = (handler: AsyncRoute) => (request: Request, response: Response, next: NextFunction) => {
  void handler(request, response, next).catch(next);
};

export function privateResponseMiddleware(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Pragma', 'no-cache');
  response.vary('X-ENS-Actor-Assertion');
  next();
}

export function corsMiddleware(origins: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header('origin');
    if (origin && !origins.includes(origin)) return next(appError('origin_forbidden', 403, 'Origin is not allowed'));
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Idempotency-Key,If-Match,X-Correlation-Id,X-Nexus-Filename,X-Nexus-Asset-Id');
    response.setHeader('Access-Control-Max-Age', '600');
    response.vary('Origin');
    if (request.method === 'OPTIONS') return response.status(204).end();
    next();
  };
}

export function authMiddleware(
  pool: Pool,
  verifyAssertion: (token: string, method: string, path: string, correlationId: string) => Promise<BffActorClaims>
) {
  return asyncRoute(async (request, _response, next) => {
    const token = request.header('x-ens-actor-assertion')?.trim();
    if (!token) throw appError('unauthorized', 401, 'BFF actor assertion is required');
    let claims: BffActorClaims;
    const path = request.originalUrl.split('?', 1)[0]!;
    try { claims = await verifyAssertion(token, request.method, path, request.correlationId); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw appError('unauthorized', 401, 'BFF actor assertion is invalid');
    }
    if (request.correlationId && claims.correlationId !== request.correlationId) {
      throw appError('unauthorized', 401, 'BFF actor assertion is invalid');
    }
    const actor = await resolveActor(pool, claims.userId, claims.tenantId);
    if (actor.role !== claims.role) throw appError('unauthorized', 401, 'BFF actor assertion is stale');
    request.actor = actor;
    next();
  });
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.header('idempotency-key')?.trim();
  if (!key || key.length > 128) throw appError('idempotency_key_required', 400, 'A valid Idempotency-Key header is required');
  return key;
}

export function parseIfMatch(request: Request): number {
  const match = request.header('if-match')?.match(/^(?:W\/)?(?:"([1-9]\d*)"|([1-9]\d*))$/);
  const version = match?.[1] ?? match?.[2];
  if (!version) throw appError('precondition_required', 428, 'If-Match with the observed version is required');
  return z.coerce.number().int().safe().positive().parse(version);
}

export function requireFeature(enabled: boolean, name: string) {
  if (!enabled) throw appError('feature_disabled', 503, `Feature ${name} is disabled`);
}

export function actorFrom(request: Request): Actor {
  if (!request.actor) throw appError('unauthorized', 401, 'Actor was not resolved');
  return request.actor;
}
