import { describe, expect, it } from 'vitest';
import { loadAdsConfig } from './config.js';
describe('Ads installation configuration', () => {
  it('keeps all providers unprepared when installation is not configured', () => {
    expect(loadAdsConfig({}).providers).toEqual({});
  });
  it('requires a dedicated encryption key and builds a fixed callback', () => {
    const env = { ADS_PUBLIC_ORIGIN: 'http://127.0.0.1:8088', ADS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), ADS_GOOGLE_CLIENT_ID: 'company-client', ADS_GOOGLE_CLIENT_SECRET: 'local-test-only', ADS_GOOGLE_API_VERSION: 'v25' };
    const config = loadAdsConfig(env);
    expect(config.providers.google?.redirectUri).toBe('http://127.0.0.1:8088/api/ads/oauth/google/callback');
    expect(config.providers.google?.scopes).toEqual(['https://www.googleapis.com/auth/adwords']);
    expect(loadAdsConfig({ ...env, ADS_TOKEN_ENCRYPTION_KEY: '' }).providers).toEqual({});
  });
  it('rejects untrusted origins, invalid versions and unapproved scopes', () => {
    const env = { ADS_PUBLIC_ORIGIN: 'http://company.example', ADS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), ADS_GOOGLE_CLIENT_ID: 'company-client', ADS_GOOGLE_CLIENT_SECRET: 'test', ADS_GOOGLE_API_VERSION: 'v25' };
    expect(() => loadAdsConfig(env)).toThrow();
    expect(() => loadAdsConfig({ ...env, ADS_PUBLIC_ORIGIN: 'https://company.example/path' })).toThrow();
    expect(() => loadAdsConfig({ ...env, ADS_PUBLIC_ORIGIN: 'https://company.example', ADS_GOOGLE_API_VERSION: '../v25' })).toThrow();
  });
  it('adopts the persistent installation key before resolving external provider configuration', () => {
    const key = Buffer.alloc(32, 7);
    const loaded = loadAdsConfig({ NODE_ENV: 'development', ADS_GOOGLE_CLIENT_ID: 'external-client', ADS_GOOGLE_CLIENT_SECRET: 'external-secret', ADS_GOOGLE_API_VERSION: 'v25' }, key);
    expect(loaded.encryptionKey).toEqual(key);
    expect(loaded.providers.google?.clientId).toBe('external-client');
  });
  it('fails closed when an explicitly configured operational encryption key file cannot be read', () => {
    expect(() => loadAdsConfig({ ADS_TOKEN_ENCRYPTION_KEY_FILE: 'nonexistent-private-ads-key-fixture' })).toThrow('Ads operational encryption key is unavailable');
  });
});
