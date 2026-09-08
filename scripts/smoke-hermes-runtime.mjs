import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FEATURES = [
  'run_submission',
  'run_status',
  'run_events_sse',
  'run_stop',
  'run_approval',
];

export function parseArguments(argumentsList) {
  const options = {
    baseUrl: process.env.HERMES_API_BASE_URL ?? 'http://127.0.0.1:8642',
    apiKeyEnvironment: 'API_SERVER_KEY',
    allowProviderUnconfigured: false,
    timeoutMs: 5000,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--allow-provider-unconfigured') {
      options.allowProviderUnconfigured = true;
      continue;
    }

    const value = argumentsList[index + 1];
    if (['--base-url', '--api-key-env', '--timeout-ms'].includes(argument) && !value) {
      throw new Error(`missing value for ${argument}`);
    }
    if (argument === '--base-url') options.baseUrl = value;
    else if (argument === '--api-key-env') options.apiKeyEnvironment = value;
    else if (argument === '--timeout-ms') options.timeoutMs = Number(value);
    else throw new Error(`unknown argument: ${argument}`);
    index += 1;
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  try {
    options.baseUrl = new URL(options.baseUrl).toString().replace(/\/$/, '');
  } catch {
    throw new Error('--base-url must be a valid HTTP URL');
  }
  if (!/^https?:\/\//.test(options.baseUrl)) {
    throw new Error('--base-url must use http or https');
  }

  return options;
}

async function requestJson({ baseUrl, path, apiKey, timeoutMs, authenticated }) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: authenticated ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`request timed out for ${path} after ${timeoutMs}ms`);
    }
    throw new Error(`request failed for ${path}: ${error?.message ?? 'network error'}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`authentication failed for ${path} (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(`request failed for ${path} (HTTP ${response.status})`);

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`invalid JSON from ${path}`);
  }
}

function containsString(value, expected) {
  if (typeof value === 'string') return value.toLowerCase() === expected;
  if (Array.isArray(value)) return value.some((item) => containsString(item, expected));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsString(item, expected));
  }
  return false;
}

function containsUnexpectedReadinessFailure(value) {
  const failures = new Set(['error', 'failed', 'unhealthy', 'unavailable']);
  if (typeof value === 'string') return failures.has(value.toLowerCase());
  if (Array.isArray(value)) return value.some(containsUnexpectedReadinessFailure);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsUnexpectedReadinessFailure);
  }
  return false;
}

export async function smokeHermes(options, logger = console) {
  const apiKey = process.env[options.apiKeyEnvironment];
  if (!apiKey) throw new Error(`${options.apiKeyEnvironment} is not configured`);

  const liveness = await requestJson({
    ...options,
    path: '/health',
    apiKey,
    authenticated: false,
  });
  if (liveness?.status !== 'ok') throw new Error('liveness check did not return status ok');
  logger.log('PASS liveness');

  const readiness = await requestJson({
    ...options,
    path: '/health/detailed',
    apiKey,
    authenticated: true,
  });
  if (readiness?.status === 'ok') {
    logger.log('PASS readiness');
  } else {
    const providerUnconfigured = containsString(readiness, 'provider_unconfigured');
    const otherFailure = containsUnexpectedReadinessFailure(readiness);
    if (!options.allowProviderUnconfigured || !providerUnconfigured || otherFailure) {
      const reason = providerUnconfigured ? 'provider_unconfigured' : readiness?.status ?? 'unknown';
      throw new Error(`readiness is degraded: ${reason}`);
    }
    logger.log('DEGRADED readiness: provider_unconfigured (allowed)');
  }

  const capabilities = await requestJson({
    ...options,
    path: '/v1/capabilities',
    apiKey,
    authenticated: true,
  });
  if (capabilities?.auth?.type !== 'bearer' || capabilities?.auth?.required !== true) {
    throw new Error('capabilities do not require bearer authentication');
  }
  const missing = REQUIRED_FEATURES.filter((feature) => capabilities?.features?.[feature] !== true);
  if (missing.length > 0) throw new Error(`missing required capabilities: ${missing.join(', ')}`);
  logger.log('PASS capabilities');
  logger.log('Hermes smoke checks passed');
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    const options = parseArguments(argumentsList);
    await smokeHermes(options);
    return 0;
  } catch (error) {
    console.error(`Hermes smoke check failed: ${error.message}`);
    return 1;
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
