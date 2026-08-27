import { describe, expect, it } from 'vitest';
import { AUDIT_EVENTS_SELECT } from './queries.js';

describe('audit trace read contract', () => {
  it('returns every Phase 4 trace field to authorized audit readers', () => {
    for (const field of [
      'operatorOrigin', 'chatSessionId', 'runId', 'toolName', 'toolCallId',
      'planId', 'planActionIndex'
    ]) {
      expect(AUDIT_EVENTS_SELECT).toContain(`"${field}"`);
    }
  });
});
