import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/worker/auth/password';
import { decryptJson, encryptJson, timingSafeEqual } from '../../src/worker/lib/crypto';
import { verifySvixSignature } from '../../src/worker/mail/providers/resend/webhook-signature';

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('pbkdf2$200000$')).toBe(true);
    expect(await verifyPassword({ hash, password: 'correct-horse-battery' })).toBe(true);
    expect(await verifyPassword({ hash, password: 'wrong-password' })).toBe(false);
    expect(await verifyPassword({ hash: 'not-a-hash', password: 'x' })).toBe(false);
  });
});

describe('credential encryption', () => {
  it('round-trips JSON with AES-GCM', async () => {
    const key = 'q8G3m1nQ6yD4kL0vX9wB2sT5rJ7hF1cZ8pM4aN6eU3I=';
    const cipher = await encryptJson(key, { apiKey: 're_test' });
    expect(cipher.startsWith('v1.')).toBe(true);
    expect(await decryptJson<{ apiKey: string }>(key, cipher)).toEqual({ apiKey: 're_test' });
    await expect(decryptJson(key, 'v1.aaa.bbb')).rejects.toThrow();
  });
});

describe('Svix webhook signatures', () => {
  it('accepts a fresh valid signature and rejects tampering', async () => {
    const rawSecret = crypto.getRandomValues(new Uint8Array(32));
    const secret = `whsec_${btoa(String.fromCharCode(...rawSecret))}`;
    const id = 'msg_1';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.received"}';
    const { hmacSha256 } = await import('../../src/worker/lib/crypto');
    const expected = await hmacSha256(rawSecret, `${id}.${timestamp}.${body}`);
    const sig = `v1,${btoa(String.fromCharCode(...expected))}`;
    const headers = new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': sig });
    expect(await verifySvixSignature({ headers }, body, secret)).toEqual({ ok: true, id });

    const bad = await verifySvixSignature({ headers }, '{"type":"nope"}', secret);
    expect(bad.ok).toBe(false);

    const old = new Headers({ 'svix-id': id, 'svix-timestamp': '1000', 'svix-signature': sig });
    expect((await verifySvixSignature({ headers: old }, body, secret)).ok).toBe(false);
  });

  it('compares tokens in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('ab', 'abc')).toBe(false);
  });
});
