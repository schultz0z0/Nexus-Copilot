import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../errors.js';
import type { RagCourseClient } from '../../integrations/ragCourseClient.js';
import { registerReferences } from './references.js';

function testApp(searchCourses: ReturnType<typeof vi.fn>, read = true) {
  const app = express();
  const router = express.Router();
  app.use((req, _res, next) => {
    req.correlationId = 'reference-route-test';
    req.actor = {
      userId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantSlug: 'ens',
      role: 'member'
    };
    next();
  });
  registerReferences(router, { searchCourses } as unknown as RagCourseClient, { read, write: false });
  app.use(router);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const normalized = error instanceof AppError
      ? error
      : error instanceof Error && error.name === 'ZodError'
        ? new AppError('validation_error', 400, 'Request validation failed')
        : new AppError('internal_error', 500, 'Internal server error');
    res.status(normalized.status).json({ error: { code: normalized.code } });
  });
  return app;
}

describe('course reference route', () => {
  it('returns the reduced RAG course selector payload with bounded input', async () => {
    const searchCourses = vi.fn().mockResolvedValue([{ referenceKey: 'ENS-123' }]);
    const response = await request(testApp(searchCourses)).get('/v1/references/courses?q=gestao&limit=12');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [{ referenceKey: 'ENS-123' }] });
    expect(searchCourses).toHaveBeenCalledWith('gestao', 12);
  });

  it('rejects invalid input before calling RAG', async () => {
    const searchCourses = vi.fn();
    const shortQuery = await request(testApp(searchCourses)).get('/v1/references/courses?q=x');
    const invalidLimit = await request(testApp(searchCourses)).get('/v1/references/courses?q=gestao&limit=26');
    const unknownQuery = await request(testApp(searchCourses)).get('/v1/references/courses?q=gestao&extra=true');
    expect(shortQuery.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(unknownQuery.status).toBe(400);
    expect(searchCourses).not.toHaveBeenCalled();
  });
});
