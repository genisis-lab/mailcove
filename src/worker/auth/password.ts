import { base64Decode, base64UrlEncode, timingSafeEqual } from '../lib/crypto';

const ITERATIONS = 200_000;
const KEY_BYTES = 32;

/**
 * PBKDF2-SHA256 via WebCrypto. Native in Workers (fast, constant memory) and
 * trivially reproducible from Node for the reset-admin-password script.
 * Format: pbkdf2$<iterations>$<salt b64url>$<hash b64url>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iterRaw, saltRaw, hashRaw] = data.hash.split('$');
  if (scheme !== 'pbkdf2' || !iterRaw || !saltRaw || !hashRaw) return false;
  const iterations = Number.parseInt(iterRaw, 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const expected = base64Decode(hashRaw);
  const actual = await derive(data.password, base64Decode(saltRaw), iterations);
  return timingSafeEqual(actual, expected);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}
