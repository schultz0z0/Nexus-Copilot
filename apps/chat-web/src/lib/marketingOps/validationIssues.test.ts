import { describe, expect, it } from 'vitest';
import { validationIssues } from './validationIssues';

describe('validationIssues', () => {
  it('accepts only display-safe validation issues', () => {
    expect(validationIssues({
      issues: [{ path: ['startsOn'], message: 'Data inválida' }]
    })).toEqual([{ path: ['startsOn'], message: 'Data inválida' }]);
  });

  it('fails closed when any issue is malformed', () => {
    expect(validationIssues({ issues: [{ path: ['name'], message: 42 }] })).toBeNull();
    expect(validationIssues({ issues: 'secret' })).toBeNull();
    expect(validationIssues(null)).toBeNull();
  });
});
