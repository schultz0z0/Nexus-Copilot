import { AppError, appError } from '../errors.js';

export interface DelegationRefreshConfig {
  url: string;
  internalKey: string;
  timeoutMs: number;
}

export function createDelegationRefresher(
  config: DelegationRefreshConfig,
  deps: { fetch: typeof globalThis.fetch } = { fetch: globalThis.fetch }
): (token: string) => Promise<string> {
  return async (token) => {
    try {
      const response = await deps.fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': config.internalKey
        },
        body: JSON.stringify({ delegation_token: token }),
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 409) {
        throw appError('delegation_invalid', 401, 'Delegation cannot be renewed');
      }
      if (!response.ok) throw appError('dependency_unavailable', 503, 'Delegation refresh is unavailable');
      const payload = await response.json() as { delegation_token?: unknown };
      if (typeof payload.delegation_token !== 'string' || payload.delegation_token.length < 20) {
        throw appError('dependency_unavailable', 503, 'Delegation refresh returned an invalid response');
      }
      return payload.delegation_token;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw appError('dependency_unavailable', 503, 'Delegation refresh is unavailable');
    }
  };
}
