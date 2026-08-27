import { describe, expect, it } from 'vitest';
import { appError } from '../errors.js';
import { errorToolResult, jsonToolResult } from './toolResults.js';

describe('MCP structured tool results', () => {
  it('mirrors success as text/structured content and sanitizes failures', () => {
    const success = jsonToolResult({ data: { id: 'resource' } });
    expect(success.structuredContent).toEqual({ data: { id: 'resource' } });
    expect(JSON.parse(success.content[0]!.text)).toEqual(success.structuredContent);

    const conflict = errorToolResult(appError(
      'version_conflict', 409, 'Version is stale', { currentVersion: 4 }
    ));
    expect(conflict.structuredContent).toEqual({
      error: {
        code: 'version_conflict', message: 'Version is stale', status: 409,
        details: { currentVersion: 4 }
      }
    });
    expect(errorToolResult(new Error('database password leaked')).structuredContent)
      .toEqual({
        error: { code: 'internal_error', message: 'Internal server error', status: 500 }
      });
  });
});
