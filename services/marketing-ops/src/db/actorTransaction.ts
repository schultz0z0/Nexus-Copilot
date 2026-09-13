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
    await client.query("select set_config('app.user_id', $1, true)", [actor.userId]);
    await client.query("select set_config('app.tenant_id', $1, true)", [actor.tenantId]);
    await client.query("select set_config('app.actor_role', $1, true)", [actor.role]);
    await client.query("select set_config('app.actor_type', 'user', true)");
    await client.query("select set_config('app.origin', 'rest', true)");
    await client.query("select set_config('app.correlation_id', $1, true)", [correlationId]);
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
