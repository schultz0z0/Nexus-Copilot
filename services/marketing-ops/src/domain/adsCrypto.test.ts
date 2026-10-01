import { describe, expect, it } from 'vitest';
import { sealAdsSecret, openAdsSecret } from './adsCrypto.js';

describe('encrypted Ads credentials', () => {
  const key = Buffer.alloc(32, 7);
  const binding = 'tenant:google:3:tokens';
  it('round trips without storing clear tokens and rejects another installation or generation', () => {
    const value = { accessToken: 'private-token', refreshToken: 'private-refresh' };
    const encrypted = sealAdsSecret(key, binding, value);
    expect(encrypted).not.toContain('private');
    expect(openAdsSecret(key, binding, encrypted)).toEqual(value);
    expect(() => openAdsSecret(key, 'other:google:3:tokens', encrypted)).toThrow();
    expect(() => openAdsSecret(key, 'tenant:google:4:tokens', encrypted)).toThrow();
    expect(() => openAdsSecret(Buffer.alloc(32, 8), binding, encrypted)).toThrow();
  });
  it('uses a fresh nonce and rejects corrupted authenticated ciphertext', () => {
    const first = sealAdsSecret(key, binding, { code: 'same' });
    const second = sealAdsSecret(key, binding, { code: 'same' });
    expect(first).not.toBe(second);
    const bytes = Buffer.from(first, 'base64url'); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    expect(() => openAdsSecret(key, binding, bytes.toString('base64url'))).toThrow();
  });
});
