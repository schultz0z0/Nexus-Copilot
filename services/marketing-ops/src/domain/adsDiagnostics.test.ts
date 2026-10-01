import { describe, expect, it } from 'vitest';
import { adsCallbackDiagnostic } from './adsDiagnostics.js';
import { appError } from '../errors.js';

describe('safe Ads callback diagnostics', () => {
  it('identifies the failing phase and a known internal exception without its message', () => {
    const issue = new TypeError('Bearer private-provider-token client_secret=private-client-secret');
    issue.stack = `${issue.message}\n    at accounts (file:///app/dist/integrations/ads/providers.js:145:19)`;
    expect(adsCallbackDiagnostic('google', 'accounts', issue)).toEqual({provider:'google',phase:'accounts',category:'TypeError',location:'integrations/ads/providers.js:145:19'});
  });
  it('keeps only allowlisted provider and database error codes', () => {
    expect(adsCallbackDiagnostic('google','exchange',appError('ads_provider_unavailable',503,'private-client-secret'))).toMatchObject({phase:'exchange',code:'ads_provider_unavailable',category:'AppError'});
    expect(adsCallbackDiagnostic('google','persistence',{code:'42501',name:'Error',message:'private-provider-token'})).toMatchObject({phase:'persistence',code:'42501'});
  });
  it('does not log arbitrary names, codes, URLs, body, headers or stack text', () => {
    const result=adsCallbackDiagnostic('google','exchange',{name:'private-name',code:'private-code',message:'private-message',body:'private-body',headers:{authorization:'private-token'},stack:'private-stack\n at https://example.test/?secret=private-secret'});
    expect(result).toEqual({provider:'google',phase:'exchange',category:'Error'});
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
