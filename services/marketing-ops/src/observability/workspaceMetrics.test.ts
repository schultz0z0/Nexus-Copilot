import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { collectWorkspaceMetrics } from './workspaceMetrics.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});

afterAll(() => pool.end());

describe('workspace metrics collector', () => {
  it('collects the real schema snapshot using the canonical event timestamp', async () => {
    const snapshot = await collectWorkspaceMetrics(pool);

    expect(snapshot.campaignsCreated).toBeGreaterThanOrEqual(0);
    expect(snapshot.campaignsWithoutOwner).toBeGreaterThanOrEqual(0);
    expect(snapshot.activeUsers24h).toBeGreaterThanOrEqual(0);
    expect(snapshot.briefingCompletionRatio).toBeGreaterThanOrEqual(0);
    expect(snapshot.timeToPlannedSeconds.count).toBeGreaterThanOrEqual(0);
    expect(snapshot.timeToPlannedSeconds.sum).toBeGreaterThanOrEqual(0);
    expect(snapshot.statusTransitions).toEqual(expect.any(Array));
    expect(snapshot.productionItems).toEqual(expect.any(Array));
  });
});
