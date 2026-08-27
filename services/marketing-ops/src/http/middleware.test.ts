import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { authMiddleware, corsMiddleware, parseIfMatch, privateResponseMiddleware } from './middleware.js';

const requestWithIfMatch = (value: string): Request => ({
  header: (name: string) => name.toLowerCase() === 'if-match' ? value : undefined
}) as Request;

describe('REST middleware contracts', () => {
  it('prevents shared caches from reusing authenticated responses', async () => {
    const app = express();
    app.use(privateResponseMiddleware);
    app.use(corsMiddleware(['https://app.example.test']));
    app.get('/private', (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .get('/private')
      .set('Origin', 'https://app.example.test');

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.headers['vary']).toContain('Authorization');
    expect(response.headers['vary']).toContain('Origin');
  });

  it('accepts complete version tags and rejects malformed or unsafe versions', () => {
    expect(parseIfMatch(requestWithIfMatch('"12"'))).toBe(12);
    expect(parseIfMatch(requestWithIfMatch('W/"12"'))).toBe(12);
    expect(parseIfMatch(requestWithIfMatch('12'))).toBe(12);
    expect(() => parseIfMatch(requestWithIfMatch('"12'))).toThrow();
    expect(() => parseIfMatch(requestWithIfMatch('12"'))).toThrow();
    expect(() => parseIfMatch(requestWithIfMatch('9007199254740992'))).toThrow();
  });

  it('does not expose unexpected token verifier errors', async () => {
    const app = express();
    app.use(authMiddleware({} as Pool, async () => {
      throw new Error('provider secret response');
    }));
    app.get('/private', (_req, res) => res.json({ ok: true }));
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const normalized = error instanceof AppError
        ? error
        : new AppError('internal_error', 500, 'Internal server error');
      res.status(normalized.status).json({
        error: { code: normalized.code, message: normalized.message }
      });
    });

    const response = await request(app)
      .get('/private')
      .set('Authorization', 'Bearer unexpected-failure');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'unauthorized', message: 'Bearer token is invalid' }
    });
    expect(JSON.stringify(response.body)).not.toContain('provider secret response');
  });
});
