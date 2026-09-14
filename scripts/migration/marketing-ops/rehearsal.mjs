const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function assertLocalDatabaseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} database URL is invalid`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use PostgreSQL`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must use a loopback PostgreSQL host`);
  }
  if (!parsed.pathname.slice(1)) throw new Error(`${label} database name is required`);
  return parsed;
}

export function assertRehearsalDatabaseName(value) {
  if (!/^nexus_m6_rehearsal_[a-z0-9_]{8,40}$/.test(value)) {
    throw new Error('destination database must use an isolated nexus_m6_rehearsal_ name');
  }
  return value;
}

export function identityMapping(tenants, principals) {
  return {
    tenants: Object.fromEntries(tenants.map(({ id }) => [String(id), String(id)])),
    principals: Object.fromEntries(principals.map(({ id }) => [String(id), String(id)]))
  };
}
