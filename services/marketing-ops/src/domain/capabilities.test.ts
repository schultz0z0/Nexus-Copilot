import { describe, expect, it } from 'vitest';
import { deriveObjectCapabilities } from './capabilities.js';

describe('object capabilities', () => {
  it('returns contextual booleans without exposing role or tenant claims', () => {
    expect(deriveObjectCapabilities('campaign', 'draft', true)).toEqual({
      read: true,
      update: true,
      note_add: true
    });
    expect(deriveObjectCapabilities('campaign_item', 'completed', true)).toEqual({
      read: true,
      reschedule: false,
      create_content: false,
      link_artifact: false
    });
    expect(deriveObjectCapabilities('content_asset', 'draft', false)).toEqual({
      read: true,
      create_version: false
    });
  });
});
