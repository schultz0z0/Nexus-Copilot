import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../auth/actor.js';

export async function withActorTransaction<T>(
  pool: Pool,
  actor: Actor,
  correlationId: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor.userId]);
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('marketing_ops.tenant_id', $1, true)", [actor.tenantId]);
    await client.query("select set_config('marketing_ops.correlation_id', $1, true)", [correlationId]);
    await client.query('set local role authenticated');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
