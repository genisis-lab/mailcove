import type { AppMiddleware } from '../auth/context';
import { isSecureDeployment } from '../env';

/**
 * Security headers for HTML/API responses. Email bodies are rendered inside a
 * sandboxed iframe via `srcdoc`, so the page CSP can stay strict.
 */
export const securityHeaders: AppMiddleware = async (c, next) => {
  // WebSocket upgrade responses are immutable; mutating them throws and the
  // handshake never completes (non-101 / network error in the browser).
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return next();
  await next();
  const headers = c.res.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (isSecureDeployment(c.env)) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const type = headers.get('content-type') ?? '';
  if (type.includes('text/html') && !headers.has('Content-Security-Policy')) {
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' wss: https:",
        "frame-src 'self' blob: https://challenges.cloudflare.com",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join('; '),
    );
  }
};

/** Rejects state-changing browser requests whose Origin does not match the app. */
export const originCheck: AppMiddleware = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const authorization = c.req.header('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) return next();
  const origin = c.req.header('origin');
  if (!origin) return next();
  const expected = new URL(c.env.APP_BASE_URL || 'http://localhost:5173');
  const actual = new URL(origin);
  const requestHost = new URL(c.req.url).host;
  if (actual.host !== expected.host && actual.host !== requestHost) {
    return c.json({ error: { code: 'bad_origin', message: 'Cross-site request blocked' } }, 403);
  }
  return next();
};
