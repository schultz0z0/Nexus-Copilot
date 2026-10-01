import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function sealAdsSecret(key: Buffer, binding: string, value: unknown): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
export function openAdsSecret<T = unknown>(key: Buffer, binding: string, encrypted: string): T {
  const packed = Buffer.from(encrypted, 'base64url');
  if (packed.length < 29) throw new Error('Invalid encrypted Ads credential');
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')) as T;
}
