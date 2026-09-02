import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, twoFactor } from 'better-auth/plugins';
import type { Db } from '../db/client';
import { authSchema } from '../db/schema';
import { authSecret, baseUrl, isSecureDeployment, type AppEnv } from '../env';
import { getSetting, userCount } from '../lib/settings';
import { hashPassword, verifyPassword } from './password';

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthUser = AuthSession['user'];

export function createAuth(env: AppEnv, db: Db) {
  const url = baseUrl(env);
  return betterAuth({
    appName: env.APP_NAME || 'Mailcove',
    baseURL: url,
    basePath: '/api/auth',
    secret: authSecret(env),
    trustedOrigins: [...new Set([url, 'http://localhost:5173', 'http://127.0.0.1:5173'])],
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
      additionalFields: {
        deviceName: { type: 'string', required: false },
        lastSeenAt: { type: 'date', required: false },
      },
    },
    user: {
      additionalFields: {
        locale: { type: 'string', required: false },
        avatarKey: { type: 'string', required: false },
        prefs: { type: 'string', required: false },
        disabled: { type: 'boolean', required: false, defaultValue: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    advanced: {
      cookiePrefix: 'mailcove',
      useSecureCookies: isSecureDeployment(env),
      database: { generateId: () => crypto.randomUUID() },
    },
    rateLimit: { enabled: false },
    plugins: [
      twoFactor({ issuer: env.APP_NAME || 'Mailcove', skipVerificationOnEnable: false }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Public sign-up is closed unless an admin opened it or this is the
        // very first account (initial setup).
        if (ctx.path === '/sign-up/email') {
          const [allowSignups, count] = await Promise.all([getSetting(db, 'allowSignups'), userCount(db)]);
          if (count > 0 && !allowSignups) {
            throw new APIError('FORBIDDEN', { message: 'Sign-ups are disabled. Ask an administrator for an account.' });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const count = await userCount(db);
            if (count === 0) return { data: { ...user, role: 'admin' } };
            return { data: { ...user, role: user.role ?? 'user' } };
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const ua = ctx?.request?.headers.get('user-agent') ?? undefined;
            return { data: { ...session, deviceName: describeDevice(ua), lastSeenAt: new Date() } };
          },
        },
      },
    },
  });
}

export function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}
