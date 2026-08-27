import dns from 'node:dns';
import pg from 'pg';

// Node.js 18+ may prefer IPv6 which is unreachable inside Docker
// containers on VPS hosts without IPv6 networking.
dns.setDefaultResultOrder('ipv4first');

export function resolveDatabaseSsl(databaseUrl: string): pg.PoolConfig['ssl'] {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
  if (sslMode === 'disable') return false;
  if (sslMode === 'verify-full') return { rejectUnauthorized: true };

  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (localHosts.has(parsed.hostname)) return undefined;
  return { rejectUnauthorized: false };
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'nexus-marketing-ops',
    ssl: resolveDatabaseSsl(databaseUrl)
  });
}
