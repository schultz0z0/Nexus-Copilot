import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors.js';
import { registerTimeline } from '../http/routes/timeline.js';
import { auditSnapshot } from './audit.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import {
  decodeTimelineCursor,
  listCampaignTimeline,
  type CampaignTimelineEvent
} from './timeline.js';

const campaignId = 'c1111111-1111-4111-8111-111111111111';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = '11111111-1111-4111-8111-111111111111';

const context = (pool: Pool): CommandContext => ({
  pool,
  actor: { userId: actorId, tenantId, tenantSlug: 'ens', role: 'member' },
  correlationId: randomUUID(),
  origin: 'rest'
});

interface TimelineDatabase {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
}

function timelineDatabase(rows: unknown[]): TimelineDatabase {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('select id from marketing_ops.campaigns')) {
      return { rowCount: 1, rows: [{ id: campaignId }] };
    }
    if (sql.includes('marketing_ops_private.list_campaign_timeline')) {
      return { rowCount: rows.length, rows };
    }
    return { rowCount: 0, rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return {
    query,
    pool: { connect: vi.fn(async () => client) } as unknown as Pool
  };
}

function timelineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    action: 'campaign.updated',
    occurredAt: '2026-07-14T15:00:00.000Z',
    actorDisplayName: 'Pessoa ENS',
    origin: 'rest',
    changes: [{ field: 'briefing', kind: 'changed' }],
    correlationId: randomUUID(),
    ...overrides
  };
}

function routeApp(database: Pool, read = true) {
  const app = express();
  const router = express.Router();
  app.use((req, _res, next) => {
    req.correlationId = randomUUID();
    req.actor = {
      userId: actorId,
      tenantId,
      tenantSlug: 'ens',
      role: 'member'
    };
    next();
  });
  registerTimeline(router, database, { read, write: false });
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

describe('audit minimization', () => {
  it('fingerprints free text and redacts secrets, signed URLs, and nested content', () => {
    const snapshot = auditSnapshot({
      id: campaignId,
      name: 'Campanha confidencial',
      objective: 'Objetivo secreto',
      briefing: 'Briefing secreto',
      notes: 'Notas privadas',
      status: 'draft',
      version: 3,
      material: {
        artifactId: 'f1111111-1111-4111-8111-111111111111',
        filename: 'planejamento-secreto.pdf',
        accessUrl: 'https://files.example.test/signed?token=raw-secret'
      },
      content: { body: 'conteudo interno', authorization: 'Bearer raw-secret' }
    });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toMatchObject({
      id: campaignId,
      status: 'draft',
      version: 3,
      name: {
        present: true,
        length: 'Campanha confidencial'.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      },
      briefing: {
        present: true,
        length: 'Briefing secreto'.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      },
      material: {
        artifactId: 'f1111111-1111-4111-8111-111111111111',
        filename: expect.objectContaining({ length: 'planejamento-secreto.pdf'.length }),
        accessUrl: { redacted: true }
      },
      content: expect.objectContaining({
        present: true,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    });
    expect(serialized).not.toContain('Objetivo secreto');
    expect(serialized).not.toContain('Briefing secreto');
    expect(serialized).not.toContain('Notas privadas');
    expect(serialized).not.toContain('planejamento-secreto.pdf');
    expect(serialized).not.toContain('raw-secret');
    expect(auditSnapshot(null)).toBeNull();
  });

  it('writes only minimized payloads to the domain outbox', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1, rows: [] }));
    const client = { query } as unknown as PoolClient;
    await writeDomainEvent(
      client,
      context({} as Pool),
      'campaign',
      campaignId,
      'marketing_ops.campaign.updated.v1',
      { campaignId, briefing: 'Briefing secreto', signedUrl: 'https://files.test/?token=secret' }
    );
    const params = query.mock.calls[0]?.[1];
    expect(params).toBeDefined();
    const payload = String(params?.[4]);
    expect(payload).not.toContain('Briefing secreto');
    expect(payload).not.toContain('https://files.test');
    expect(JSON.parse(payload)).toMatchObject({
      campaignId,
      briefing: expect.objectContaining({ sha256: expect.any(String) }),
      signedUrl: { redacted: true }
    });
  });
});

describe('campaign timeline projection', () => {
  it('returns safe events without leaking raw historical audit snapshots', async () => {
    const rawRow = timelineRow({
      before_state: { briefing: 'Briefing secreto', token: 'raw-secret' },
      after_state: { notes: 'Notas privadas', accessUrl: 'https://files.test/signed' }
    });
    const { pool } = timelineDatabase([rawRow]);
    const result = await listCampaignTimeline(context(pool), campaignId, { limit: 25 });

    expect(result).toEqual({
      data: [expect.objectContaining({
        action: 'campaign.updated',
        actor: { displayName: 'Pessoa ENS' },
        changes: [{ field: 'briefing', kind: 'changed' }]
      })],
      nextCursor: null
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('before_state');
    expect(serialized).not.toContain('after_state');
    expect(serialized).not.toContain('Briefing secreto');
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('https://files.test');
  });

  it('normalizes unknown actions and drops unrecognized field names', async () => {
    const { pool } = timelineDatabase([timelineRow({
      action: 'secret-action:Briefing secreto',
      changes: [
        { field: 'status', kind: 'changed' },
        { field: 'cliente-confidencial', kind: 'added' }
      ]
    })]);

    const result = await listCampaignTimeline(context(pool), campaignId, { limit: 25 });

    expect(result.data[0]).toMatchObject({
      action: 'campaign.changed',
      changes: [{ field: 'status', kind: 'changed' }]
    });
    expect(JSON.stringify(result)).not.toContain('Briefing secreto');
    expect(JSON.stringify(result)).not.toContain('cliente-confidencial');
  });

  it('uses a stable cursor and validates it before opening the database', async () => {
    const first = timelineRow({
      id: 'a1111111-1111-4111-8111-111111111111',
      occurredAt: '2026-07-14T16:00:00.000Z'
    });
    const second = timelineRow({
      id: 'b1111111-1111-4111-8111-111111111111',
      occurredAt: '2026-07-14T15:00:00.000Z'
    });
    const { pool } = timelineDatabase([first, second]);
    const page = await listCampaignTimeline(context(pool), campaignId, { limit: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeTimelineCursor(page.nextCursor ?? '')).toEqual({
      occurredAt: first.occurredAt,
      id: first.id
    });

    const invalid = timelineDatabase([]);
    await expect(listCampaignTimeline(context(invalid.pool), campaignId, {
      limit: 25,
      cursor: 'not-a-cursor'
    })).rejects.toMatchObject({ code: 'validation_error' });
    expect(invalid.query).not.toHaveBeenCalled();
  });

  it('exposes strict route pagination and honors the read feature gate', async () => {
    const { pool } = timelineDatabase([timelineRow()]);
    const ok = await request(routeApp(pool)).get(`/v1/campaigns/${campaignId}/timeline?limit=12`);
    const invalid = await request(routeApp(pool)).get(`/v1/campaigns/${campaignId}/timeline?limit=101`);
    const unknown = await request(routeApp(pool)).get(`/v1/campaigns/${campaignId}/timeline?extra=true`);
    const disabled = await request(routeApp(pool, false)).get(`/v1/campaigns/${campaignId}/timeline`);

    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(1);
    expect(ok.body.page).toMatchObject({ limit: 12, count: 1, nextCursor: null });
    expect(invalid.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(disabled.status).toBe(503);
  });

  it('keeps the public event contract bounded', () => {
    const event: CampaignTimelineEvent = {
      id: randomUUID(),
      action: 'material.linked',
      occurredAt: '2026-07-14T15:00:00.000Z',
      actor: { displayName: 'Pessoa ENS' },
      origin: 'rest',
      changes: [{ field: 'material', kind: 'added' }],
      correlationId: randomUUID()
    };
    expect(Object.keys(event).sort()).toEqual([
      'action', 'actor', 'changes', 'correlationId', 'id', 'occurredAt', 'origin'
    ]);
  });
});
