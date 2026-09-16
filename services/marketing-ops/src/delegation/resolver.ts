import { AppError, appError } from '../errors.js';

export interface DelegationResolveConfig {
  url: string;
  internalKey: string;
  timeoutMs: number;
}

const MAX_RESPONSE_BYTES = 16_384;

export function createDelegationResolver(
  config: DelegationResolveConfig,
  deps: { fetch: typeof globalThis.fetch } = { fetch: globalThis.fetch }
): (reference: string) => Promise<string> {
  return async (reference) => {
    try {
      const response = await deps.fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': config.internalKey
        },
        body: JSON.stringify({ delegation_reference: reference }),
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      if ([401, 403, 404, 409].includes(response.status)) {
        throw appError('delegation_invalid', 401, 'Delegation reference cannot be resolved');
      }
      if (!response.ok) {
        throw appError('dependency_unavailable', 503, 'Delegation resolution is unavailable');
      }
      const rawPayload = await response.text();
      if (Buffer.byteLength(rawPayload, 'utf8') > MAX_RESPONSE_BYTES) {
        throw appError('dependency_unavailable', 503, 'Delegation resolution returned an invalid response');
      }
      const payload = JSON.parse(rawPayload) as { delegation_token?: unknown };
      if (typeof payload.delegation_token !== 'string' || payload.delegation_token.length < 20) {
        throw appError('dependency_unavailable', 503, 'Delegation resolution returned an invalid response');
      }
      return payload.delegation_token;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw appError('dependency_unavailable', 503, 'Delegation resolution is unavailable');
    }
  };
}
