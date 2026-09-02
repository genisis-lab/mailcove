import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiKeyScope } from '../../shared/types';
import type { Db } from '../db/client';
import { users, type ApiKey, type User } from '../db/schema';
import type { AppEnv } from '../env';
import { forbidden, unauthorized } from '../lib/http';
import { hasScope, verifyApiKey } from './api-keys';
import type { Auth } from './auth';

export type Principal =
  | { kind: 'session'; user: User; sessionId: string; scopes: ApiKeyScope[] }
  | { kind: 'api_key'; user: User; key: ApiKey; scopes: ApiKeyScope[] };

export type AppVariables = {
  env: AppEnv;
  db: Db;
  auth: Auth;
  principal: Principal | null;
  requestId: string;
};

export type AppContext = Context<{ Bindings: AppEnv; Variables: AppVariables }>;
export type AppMiddleware = MiddlewareHandler<{ Bindings: AppEnv; Variables: AppVariables }>;

/** Resolves the caller from either a better-auth session cookie or a bearer API key. */
export const resolvePrincipal: AppMiddleware = async (c, next) => {
  const authorization = c.req.header('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (bearer && bearer.startsWith('mc_live_')) {
    const verified = await verifyApiKey(c.var.db, bearer);
    if (!verified) throw unauthorized('Invalid or revoked API key');
    c.set('principal', { kind: 'api_key', user: verified.user, key: verified.key, scopes: verified.key.scopes });
    return next();
  }

  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user) {
    const user = await c.var.db.select().from(users).where(eq(users.id, session.user.id)).get();
    if (user && !user.disabled && !user.banned) {
      c.set('principal', { kind: 'session', user, sessionId: session.session.id, scopes: ['admin'] });
      return next();
    }
  }
  c.set('principal', null);
  return next();
};

export const requireUser: AppMiddleware = async (c, next) => {
  if (!c.var.principal) throw unauthorized();
  return next();
};

export function requireScope(scope: ApiKeyScope): AppMiddleware {
  return async (c, next) => {
    const principal = c.var.principal;
    if (!principal) throw unauthorized();
    if (principal.kind === 'api_key' && !hasScope(principal.scopes, scope)) {
      throw forbidden(`This API key lacks the ${scope} scope`);
    }
    return next();
  };
}

export const requireAdmin: AppMiddleware = async (c, next) => {
  const principal = c.var.principal;
  if (!principal) throw unauthorized();
  if (principal.user.role !== 'admin') throw forbidden('Administrator access required');
  if (principal.kind === 'api_key' && !hasScope(principal.scopes, 'admin')) {
    throw forbidden('This API key lacks the admin scope');
  }
  return next();
};

export function currentUser(c: AppContext): User {
  const principal = c.var.principal;
  if (!principal) throw unauthorized();
  return principal.user;
}

export function isAdmin(user: User): boolean {
  return user.role === 'admin';
}
