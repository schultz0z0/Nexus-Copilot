import type { AdsProvider } from '../integrations/ads/types.js';
export type AdsCallbackPhase = 'verifier' | 'exchange' | 'accounts' | 'persistence';
const categories = new Set(['Error','TypeError','RangeError','SyntaxError','AppError','TimeoutError','AbortError']);
const codes = new Set(['ads_provider_unavailable','ads_provider_error','ads_permission_required','ads_reconnect_required','ads_invalid_response','ads_rate_limited','ads_page_limit','ads_account_unavailable','42501','23505','23503','22P02','42601']);

// Only fixed categories and source locations are diagnostic data. Never emit
// messages, bodies, headers, URLs, credentials or the original exception.
export function adsCallbackDiagnostic(provider: AdsProvider, phase: AdsCallbackPhase, issue: unknown): Record<string, string> {
  const value = issue && typeof issue === 'object' ? issue as {name?:unknown;code?:unknown;stack?:unknown} : {};
  const result: Record<string,string> = {provider,phase,category:typeof value.name==='string' && categories.has(value.name)?value.name:'Error'};
  if(typeof value.code==='string' && codes.has(value.code)) result.code=value.code;
  if(typeof value.stack==='string') {
    const frame=value.stack.slice(0,8192).split('\n').slice(1).map(line=>line.match(/^\s+at [^\r\n]*\(?file:\/\/\/app\/dist\/(domain\/ads|integrations\/ads\/providers)\.js:(\d+):(\d+)\)?$/)).find(Boolean);
    if(frame) result.location=`${frame[1]}.js:${frame[2]}:${frame[3]}`;
  }
  return result;
}
