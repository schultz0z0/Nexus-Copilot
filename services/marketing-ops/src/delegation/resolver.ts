import { AppError, appError } from '../errors.js';

export interface DelegationResolveConfig {
  url: string;
  internalKey: string;
  timeoutMs: number;
}

const MAX_RESPONSE_BYTES = 16_384;

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw appError('dependency_unavailable', 503, 'Delegation resolution returned an invalid response');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw appError('dependency_unavailable', 503, 'Delegation resolution returned an invalid response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString('utf8');
}

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
      const rawPayload = await readBoundedResponse(response);
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
