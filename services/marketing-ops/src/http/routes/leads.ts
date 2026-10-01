import type { Router, Response, Request } from 'express';
import type { Pool } from 'pg';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { confirmLeadImport, createLeadSource, createResultReport, getLeadImportPreview, listCampaignLeads, listCaptureReviews, listLeadSources, listReportRevisions, listResultReports, previewLeadImport, resolveCaptureReview, updateLeadSource, updateResultReport } from '../../domain/leads.js';
import { ImportConfirmSchema, PublicCaptureSchema } from '../../domain/leadsContracts.js';
import { getLeadResults } from '../../domain/leadsResults.js';
import { hashCanonicalPayload } from '../../domain/hash.js';
import { appError } from '../../errors.js';
import { actorFrom, asyncRoute, parseIfMatch, requireFeature, requireIdempotencyKey } from '../middleware.js';
import type { BffAssertionConfig } from '../../auth/bffAssertion.js';

const uuid = z.string().uuid();
const capabilitySchema = z.object({ publicId: z.string().regex(/^[A-Za-z0-9_-]{32}$/) });
const params = z.object({ id: uuid, sourceId: uuid.optional(), previewId: uuid.optional(), reportId: uuid.optional(), captureId: uuid.optional() });
const leadQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: uuid.optional(), classification: z.enum(['cold', 'lead']).optional() }).strict();
const resultsQuery = z.object({ campaignId: uuid.optional(), from: z.string().date().optional(), to: z.string().date().optional() }).strict().refine(query => !query.from || !query.to || query.from <= query.to, 'Period must be ordered');

export function registerLeads(router: Router, pool: Pool, features: { read: boolean; write: boolean }): void {
  const context = (request: Request) => ({ pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' as const });
  router.get('/v1/campaigns/:id/lead-sources', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    response.json({ data: await listLeadSources(context(request), params.parse(request.params).id) });
  }));
  router.post('/v1/campaigns/:id/lead-sources', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const data = await createLeadSource(context(request), params.parse(request.params).id, request.body, requireIdempotencyKey(request));
    response.status(201).setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.patch('/v1/campaigns/:id/lead-sources/:sourceId', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id, sourceId } = params.parse(request.params);
    const data = await updateLeadSource(context(request), id, sourceId!, parseIfMatch(request), request.body, requireIdempotencyKey(request));
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.get('/v1/campaigns/:id/leads', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const filters = leadQuery.parse(request.query);
    const result = await listCampaignLeads(context(request), params.parse(request.params).id, filters);
    response.json({ data: result.data, page: { limit: filters.limit, count: result.data.length, nextCursor: result.nextCursor } });
  }));
  router.post('/v1/campaigns/:id/lead-imports/preview', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    response.status(201).json({ data: await previewLeadImport(context(request), params.parse(request.params).id, request.body, requireIdempotencyKey(request)) });
  }));
  router.get('/v1/campaigns/:id/lead-imports/:previewId', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { id, previewId } = params.parse(request.params);
    response.json({ data: await getLeadImportPreview(context(request), id, previewId!) });
  }));
  router.post('/v1/campaigns/:id/lead-imports/:previewId/confirm', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id, previewId } = params.parse(request.params);
    response.json({ data: await confirmLeadImport(context(request), id, previewId!, request.body, requireIdempotencyKey(request)) });
  }));
  router.get('/v1/campaigns/:id/result-reports', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    response.json({ data: await listResultReports(context(request), params.parse(request.params).id) });
  }));
  router.post('/v1/campaigns/:id/result-reports', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const data = await createResultReport(context(request), params.parse(request.params).id, request.body, requireIdempotencyKey(request));
    response.status(201).setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.patch('/v1/campaigns/:id/result-reports/:reportId', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id, reportId } = params.parse(request.params);
    const data = await updateResultReport(context(request), id, reportId!, parseIfMatch(request), request.body, requireIdempotencyKey(request));
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.get('/v1/campaigns/:id/result-reports/:reportId/revisions', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { id, reportId } = params.parse(request.params);
    response.json({ data: await listReportRevisions(context(request), id, reportId!) });
  }));
  router.get('/v1/campaigns/:id/lead-capture-reviews', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    response.json({ data: await listCaptureReviews(context(request), params.parse(request.params).id) });
  }));
  router.post('/v1/campaigns/:id/lead-capture-reviews/:captureId/resolve', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id, captureId } = params.parse(request.params);
    const parsed = ImportConfirmSchema.parse({ decisions: [{ ...request.body, rowIndex: 0 }] }).decisions[0]!;
    const { rowIndex: _rowIndex, ...decision } = parsed;
    response.json({ data: await resolveCaptureReview(context(request), id, captureId!, decision, requireIdempotencyKey(request)) });
  }));
  router.get('/v1/results', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    response.json({ data: await getLeadResults(context(request), resultsQuery.parse(request.query)) });
  }));
}

function publicHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.vary('Origin');
}
export type CaptureKeyring = Pick<BffAssertionConfig, 'activeKid' | 'activeKey' | 'previousKid' | 'previousKey'>;
export function captureClientIdentity(request: Request, keyring?: CaptureKeyring): string {
  const fallback = request.socket.remoteAddress || 'unknown';
  if (!keyring) return fallback;
  const ip = request.header('x-ens-capture-client');
  const timestamp = request.header('x-ens-capture-time');
  const signature = request.header('x-ens-capture-signature');
  const kid = request.header('x-ens-capture-kid');
  if (!ip || !isIP(ip) || !timestamp || !/^[0-9]{10,12}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) return fallback;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 30) return fallback;
  const key = kid === keyring.activeKid ? keyring.activeKey : kid === keyring.previousKid ? keyring.previousKey : undefined;
  if (!key || Buffer.byteLength(key) < 32) return fallback;
  const expected = createHmac('sha256', key).update(`${request.params.publicId}\n${timestamp}\n${ip}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? ip : fallback;
}
export function createCaptureLimiter(options: { maxClients: number; max: number; windowMs: number } = { maxClients: 10000, max: 30, windowMs: 60000 }): (key: string) => void {
  const clients = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;
  return key => {
    const now = Date.now();
    // Capacity can equal the limit; waiting for `>` would permanently freeze
    // new visitors after the first full map. Bound repeated full-map scans too.
    if (clients.size >= options.maxClients && now >= nextSweepAt) {
      for (const [client, entry] of clients) if (entry.resetAt <= now) clients.delete(client);
      nextSweepAt = now + Math.min(1000, options.windowMs);
    }
    const previous = clients.get(key);
    if (!previous && clients.size >= options.maxClients) throw appError('rate_limited', 429, 'Too many active capture clients', { retryAfter: 1 });
    const entry = previous && previous.resetAt > now ? { ...previous, count: previous.count + 1 } : { count: 1, resetAt: now + options.windowMs };
    clients.set(key, entry);
    if (entry.count > options.max) throw appError('rate_limited', 429, 'Too many submissions', { retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) });
  };
}
export function registerPublicLeads(router: Router, pool: Pool, features: { read: boolean; write: boolean }, captureKeyring?: CaptureKeyring): void {
  const limit = createCaptureLimiter();
  const rate = (request: Request, response: Response): void => {
    const ip = captureClientIdentity(request, captureKeyring);
    const key = `${ip}:${request.params.publicId}`;
    try { limit(key); }
    catch (error) {
      response.setHeader('Retry-After', String((error as { details?: { retryAfter?: number } }).details?.retryAfter ?? 1));
      throw error;
    }
  };
  const origin = async (request: Request, response: Response): Promise<string> => {
    requireFeature(features.write, 'write');
    publicHeaders(response);
    const { publicId } = capabilitySchema.parse(request.params);
    const result = await pool.query('select * from marketing_ops_private.public_lead_source($1)', [publicId]);
    const source = result.rows[0];
    if (!source || source.kind !== 'landing_page') throw appError('not_found', 404, 'Capture source not found');
    const value = request.header('origin');
    if (!value || !source.allowed_origins.includes(value)) throw appError('origin_forbidden', 403, 'Origin is not allowed');
    response.setHeader('Access-Control-Allow-Origin', value);
    response.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '300');
    return value;
  };
  router.options('/public/capture/:publicId', asyncRoute(async (request, response) => {
    rate(request, response);
    await origin(request, response);
    response.status(204).end();
  }));
  router.post('/public/capture/:publicId', asyncRoute(async (request, response) => {
    rate(request, response);
    const allowedOrigin = await origin(request, response);
    if (Number(request.header('content-length') ?? 0) > 16384 || Buffer.byteLength(JSON.stringify(request.body ?? {})) > 16384) throw appError('payload_too_large', 413, 'Form body exceeds 16 KiB');
    const input = PublicCaptureSchema.parse(request.body);
    // Honeypot keeps the response uniform while avoiding a stored spam contact.
    if (input.website) { response.status(202).json({ accepted: true }); return; }
    const { publicId } = capabilitySchema.parse(request.params);
    const result = await pool.query('select marketing_ops_private.capture_public_lead($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::uuid) as result', [publicId, allowedOrigin, input.submissionId, input.name, input.email ?? null, input.phone ?? null, input.company ?? null, JSON.stringify(input.utm ?? {}), hashCanonicalPayload(input), request.correlationId]);
    const output = result.rows[0]?.result;
    if (output === 'not_found') throw appError('not_found', 404, 'Capture source not found');
    if (output === 'origin_forbidden') throw appError('origin_forbidden', 403, 'Origin is not allowed');
    if (output === 'conflict') throw appError('idempotency_conflict', 409, 'Submission identifier was already used');
    if (output !== 'accepted') throw appError('validation_error', 400, 'Invalid form submission');
    response.status(202).json({ accepted: true });
  }));
  router.get('/public/capture/:publicId/whatsapp', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    publicHeaders(response);
    rate(request, response);
    const { publicId } = capabilitySchema.parse(request.params);
    const found = await pool.query('select marketing_ops_private.record_public_whatsapp_click($1,$2::uuid) as phone', [publicId, request.correlationId]);
    const phone = found.rows[0]?.phone;
    if (!phone || !/^[1-9][0-9]{7,14}$/.test(phone)) throw appError('not_found', 404, 'Capture source not found');
    response.redirect(302, `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Tenho interesse. Referência: ${publicId.slice(0, 8)}`)}`);
  }));
}
