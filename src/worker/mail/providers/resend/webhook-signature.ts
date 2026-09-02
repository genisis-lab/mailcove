import { base64Decode, hmacSha256, timingSafeEqual } from '../../../lib/crypto';

/**
 * Verifies Svix-style webhook signatures (used by Resend). Adapted from
 * QuickInbox (MIT). Supports both `svix-*` and `webhook-*` header names.
 */
export async function verifySvixSignature(
  request: { headers: Headers },
  rawBody: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const id = request.headers.get('svix-id') ?? request.headers.get('webhook-id');
  const timestamp = request.headers.get('svix-timestamp') ?? request.headers.get('webhook-timestamp');
  const signatures = request.headers.get('svix-signature') ?? request.headers.get('webhook-signature');
  if (!id || !timestamp || !signatures) return { ok: false, reason: 'missing_signature_headers' };

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > toleranceSeconds) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const secretBytes = base64Decode(secret.replace(/^whsec_/, ''));
  const expected = await hmacSha256(secretBytes, `${id}.${timestamp}.${rawBody}`);
  const expectedB64 = btoa(String.fromCharCode(...expected));

  for (const part of signatures.split(/\s+/)) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    if (timingSafeEqual(value, expectedB64)) return { ok: true, id };
  }
  return { ok: false, reason: 'signature_mismatch' };
}
