import { describe, expect, it } from 'vitest';
import { appendCampaignNoteText } from './campaigns.js';

describe('campaign note append', () => {
  it('preserves existing notes with a clear delimiter and enforces the canonical limit', () => {
    expect(appendCampaignNoteText('Nota anterior', ' Nova decisão '))
      .toBe('Nota anterior\n\nNova decisão');
    expect(() => appendCampaignNoteText('a'.repeat(9_999), 'bb'))
      .toThrowError(expect.objectContaining({ code: 'validation_error', status: 400 }));
  });
});
