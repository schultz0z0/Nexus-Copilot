import { AppError } from '../errors.js';

export function jsonToolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

export function errorToolResult(error: unknown, trace?: Record<string, unknown>) {
  const safe = error instanceof AppError
    ? {
        code: error.code,
        message: error.message,
        status: error.status,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    : { code: 'internal_error', message: 'Internal server error', status: 500 };
  const value = { error: safe, ...(trace ? { trace } : {}) };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value
  };
}
