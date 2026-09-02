const encoder = new TextEncoder();

export function newId(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64Decode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexDecode(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return hexEncode(new Uint8Array(digest));
}

export async function hmacSha256(key: string | Uint8Array, message: string | Uint8Array): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = typeof message === 'string' ? encoder.encode(message) : message;
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data as BufferSource);
  return new Uint8Array(sig);
}

export function timingSafeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const ab = typeof a === 'string' ? encoder.encode(a) : a;
  const bb = typeof b === 'string' ? encoder.encode(b) : b;
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// --- Symmetric encryption for provider credentials at rest (AES-256-GCM) ---

async function importAesKey(rawKey: string): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(rawKey);
  } catch {
    bytes = encoder.encode(rawKey);
  }
  if (bytes.length !== 32) {
    // Derive a 32-byte key from whatever was configured so misconfiguration fails soft in dev.
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    bytes = new Uint8Array(digest);
  }
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(rawKey: string, value: unknown): Promise<string> {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function decryptJson<T = unknown>(rawKey: string, payload: string): Promise<T> {
  const [version, ivPart, dataPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !dataPart) throw new Error('Unsupported ciphertext format');
  const key = await importAesKey(rawKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64Decode(ivPart) as BufferSource },
    key,
    base64Decode(dataPart) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
