import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: ContentfulStatusCode, code: string, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
export const tooLarge = (message = 'Payload too large') => new HttpError(413, 'too_large', message);
export const rateLimited = (message = 'Too many requests') => new HttpError(429, 'rate_limited', message);
export const upstream = (code: string, message?: string) => new HttpError(502, code, message);

export function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof HttpError) {
    return c.json(
      { error: { code: error.code, message: error.message, details: error.details ?? undefined } },
      error.status,
    );
  }
  console.error('Unhandled error', error);
  const message = error instanceof Error ? error.message : 'Internal error';
  return c.json({ error: { code: 'internal_error', message } }, 500);
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export function parseIntParam(value: string | undefined, fallback: number, max = 200): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
