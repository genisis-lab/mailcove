import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAdmin } from '../auth/context';
import { domains, mailboxes, users } from '../db/schema';
import { baseUrl } from '../env';
import { audit } from '../lib/audit';
import { clientIp, HttpError } from '../lib/http';
import { pushConfigured } from '../lib/push';
import { rateLimit } from '../lib/rate-limit';
import { getSettings, setSettings, userCount } from '../lib/settings';
import { defaultProviderKind, PROVIDER_CAPABILITIES, resolveCredentials } from '../mail/providers/registry';
import { router } from './router';

export const setupRoutes = router();

/** Public, cache-free description of this instance used by the SPA shell. */
setupRoutes.get('/config', async (c) => {
  const db = c.var.db;
  const settings = await getSettings(db);
  const count = await userCount(db);
  return c.json({
    appName: settings.appName,
    logoUrl: settings.logoKey ? '/api/branding/logo' : null,
    accentColor: settings.accentColor,
    allowSignups: settings.allowSignups,
    needsSetup: count === 0 || !settings.setupCompleted,
    hasUsers: count > 0,
    pushPublicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
    baseUrl: baseUrl(c.env),
    version: '0.1.0',
  });
});

setupRoutes.get('/branding/logo', async (c) => {
  const settings = await getSettings(c.var.db);
  if (!settings.logoKey) return c.notFound();
  const object = await c.env.STORAGE.get(settings.logoKey);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

/** Step-by-step status for the first-run wizard. */
setupRoutes.get('/setup/status', async (c) => {
  const db = c.var.db;
  const count = await userCount(db);
  const settings = await getSettings(db);
  const providerStatus: Record<string, { configured: boolean; label: string }> = {};
  for (const kind of Object.keys(PROVIDER_CAPABILITIES) as Array<keyof typeof PROVIDER_CAPABILITIES>) {
    const creds = await resolveCredentials(c.env, db, kind);
    const caps = PROVIDER_CAPABILITIES[kind];
    const configured = kind === 'cloudflare' ? Boolean(c.env.EMAIL) : caps.credentialFields.filter((f) => f.required).every((f) => Boolean(creds[f.name]));
    providerStatus[kind] = { configured, label: caps.label };
  }
  const domainCount = Number((await db.select({ n: sql<number>`count(*)` }).from(domains).get())?.n ?? 0);
  const mailboxCount = Number((await db.select({ n: sql<number>`count(*)` }).from(mailboxes).get())?.n ?? 0);
  return c.json({
    hasAdmin: count > 0,
    setupCompleted: settings.setupCompleted,
    defaultProvider: defaultProviderKind(c.env),
    providers: providerStatus,
    domainCount,
    mailboxCount,
    encryptionKeyConfigured: Boolean(c.env.ENCRYPTION_KEY),
    authSecretConfigured: Boolean(c.env.AUTH_SECRET && c.env.AUTH_SECRET.length >= 16),
    cloudflareTokenConfigured: Boolean(c.env.CF_API_TOKEN),
    workerName: c.env.EMAIL_WORKER_NAME,
    baseUrl: baseUrl(c.env),
  });
});

const adminSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(256),
});

/** Creates the first administrator. Only works while the instance has no users. */
setupRoutes.post('/setup/admin', rateLimit('AUTH_RATE_LIMITER'), zValidator('json', adminSchema), async (c) => {
  const db = c.var.db;
  if ((await userCount(db)) > 0) throw new HttpError(409, 'already_setup', 'An administrator already exists. Sign in instead.');
  const body = c.req.valid('json');
  const response = await c.var.auth.api.signUpEmail({
    body: { name: body.name, email: body.email.toLowerCase(), password: body.password },
    headers: c.req.raw.headers,
    asResponse: true,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new HttpError(400, 'signup_failed', detail.message ?? 'Could not create the administrator account.');
  }
  await db.update(users).set({ role: 'admin', emailVerified: true }).where(eq(users.email, body.email.toLowerCase()));
  await audit(db, { action: 'setup.admin_created', targetType: 'user', metadata: { email: body.email }, ip: clientIp(c), userAgent: c.req.header('user-agent') });
  // Forward better-auth's session cookies so the wizard continues signed in.
  const out = c.json({ ok: true });
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') out.headers.append('Set-Cookie', value);
  });
  return out;
});

setupRoutes.post('/setup/complete', requireAdmin, async (c) => {
  await setSettings(c.var.db, { setupCompleted: true });
  await audit(c.var.db, { actorUserId: c.var.principal!.user.id, action: 'setup.completed' });
  return c.json({ ok: true });
});
