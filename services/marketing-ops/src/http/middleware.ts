import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { resolveActor, type Actor } from '../auth/actor.js';
import type { SupabaseUser } from '../auth/supabaseAuth.js';
import { AppError, appError } from '../errors.js';

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
  response.vary('Authorization');
  next();
}

export function corsMiddleware(origins: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header('origin');
    if (origin && !origins.includes(origin)) return next(appError('origin_forbidden', 403, 'Origin is not allowed'));
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,If-Match,X-Correlation-Id,X-Nexus-Filename,X-Nexus-Asset-Id,X-Tenant-Id');
    response.setHeader('Access-Control-Max-Age', '600');
    response.vary('Origin');
    if (request.method === 'OPTIONS') return response.status(204).end();
    next();
  };
}

export function authMiddleware(pool: Pool, verifyToken: (token: string) => Promise<SupabaseUser>) {
  return asyncRoute(async (request, _response, next) => {
    const match = request.header('authorization')?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw appError('unauthorized', 401, 'Bearer token is required');
    let user: SupabaseUser;
    try { user = await verifyToken(match[1]); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw appError('unauthorized', 401, 'Bearer token is invalid');
    }
    request.actor = await resolveActor(pool, user.id, request.header('x-tenant-id')?.trim());
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
