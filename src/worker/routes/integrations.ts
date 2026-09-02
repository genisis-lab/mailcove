import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../../shared/types';
import { ALL_SCOPES, createApiKey } from '../auth/api-keys';
import { currentUser, isAdmin, requireScope, requireUser } from '../auth/context';
import type { Db } from '../db/client';
import { apiKeys, pushSubscriptions, webhookDeliveries, webhooks, type User } from '../db/schema';
import { audit } from '../lib/audit';
import { newId, randomToken } from '../lib/crypto';
import { badRequest, forbidden, notFound } from '../lib/http';
import { pushConfigured } from '../lib/push';
import { getSettings } from '../lib/settings';
import { router } from './router';

// --- API keys ----------------------------------------------------------------

export const apiKeyRoutes = router();
apiKeyRoutes.use('*', requireUser);

apiKeyRoutes.get('/', async (c) => {
  const user = currentUser(c);
  const rows = await c.var.db.select().from(apiKeys).where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt));
  return c.json({ items: rows.map((k) => ({ ...k, keyHash: undefined })), scopes: ALL_SCOPES });
});

apiKeyRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      name: z.string().trim().min(1).max(100),
      scopes: z.array(z.enum(['mail:read', 'mail:send', 'mail:write', 'contacts:read', 'admin'])).min(1),
      expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
    }),
  ),
  async (c) => {
    const user = currentUser(c);
    if (c.var.principal?.kind === 'api_key') throw forbidden('API keys cannot mint other API keys.');
    const settings = await getSettings(c.var.db);
    if (!settings.publicApiEnabled) throw forbidden('The public API is disabled by an administrator.');
    const body = c.req.valid('json');
    if (body.scopes.includes('admin') && !isAdmin(user)) throw forbidden('Only administrators can create admin-scoped keys.');
    const { key, secret } = await createApiKey(c.var.db, {
      userId: user.id,
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
    });
    await audit(c.var.db, { actorUserId: user.id, action: 'api_key.create', targetType: 'api_key', targetId: key.id, metadata: { scopes: body.scopes } });
    return c.json({ key: { ...key, keyHash: undefined }, secret }, 201);
  },
);

apiKeyRoutes.delete('/:id', async (c) => {
  const user = currentUser(c);
  const row = await c.var.db.select().from(apiKeys).where(and(eq(apiKeys.id, c.req.param('id')), eq(apiKeys.userId, user.id))).get();
  if (!row) throw notFound('API key');
  await c.var.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, row.id));
  await audit(c.var.db, { actorUserId: user.id, action: 'api_key.revoke', targetType: 'api_key', targetId: row.id });
  return c.json({ ok: true });
});

// --- Outgoing webhooks -------------------------------------------------------

export const outgoingWebhookRoutes = router();
outgoingWebhookRoutes.use('*', requireUser);

const webhookSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  description: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
  global: z.boolean().optional(),
});

outgoingWebhookRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const own = await c.var.db.select().from(webhooks).where(eq(webhooks.userId, user.id)).orderBy(desc(webhooks.createdAt));
  const global = isAdmin(user) ? await c.var.db.select().from(webhooks).where(isNull(webhooks.userId)).orderBy(desc(webhooks.createdAt)) : [];
  return c.json({ items: [...own, ...global].map((w) => ({ ...w, secret: undefined, global: w.userId === null })) });
});

outgoingWebhookRoutes.post('/', requireScope('mail:write'), zValidator('json', webhookSchema), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  if (body.global && !isAdmin(user)) throw forbidden('Only administrators can create global webhooks.');
  const url = new URL(body.url);
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw badRequest('https_required', 'Webhook URLs must use https.');
  const id = newId();
  const secret = `whsec_${randomToken(32)}`;
  await c.var.db.insert(webhooks).values({
    id,
    userId: body.global ? null : user.id,
    url: body.url,
    secret,
    events: body.events,
    description: body.description ?? null,
    enabled: body.enabled ?? true,
  });
  await audit(c.var.db, { actorUserId: user.id, action: 'webhook.create', targetType: 'webhook', targetId: id, metadata: { url: body.url, global: Boolean(body.global) } });
  const row = await c.var.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
  return c.json({ webhook: { ...row, global: body.global ?? false }, secret }, 201);
});

async function ownedWebhook(db: Db, user: User, id: string) {
  const row = await db.select().from(webhooks).where(eq(webhooks.id, id)).get();
  if (!row) throw notFound('Webhook');
  if (row.userId !== user.id && !(row.userId === null && isAdmin(user))) throw forbidden();
  return row;
}

outgoingWebhookRoutes.patch('/:id', requireScope('mail:write'), zValidator('json', webhookSchema.partial()), async (c) => {
  const row = await ownedWebhook(c.var.db, currentUser(c), c.req.param('id'));
  const body = c.req.valid('json');
  await c.var.db
    .update(webhooks)
    .set({ url: body.url ?? row.url, events: body.events ?? row.events, description: body.description === undefined ? row.description : body.description, enabled: body.enabled ?? row.enabled })
    .where(eq(webhooks.id, row.id));
  return c.json({ webhook: { ...(await c.var.db.select().from(webhooks).where(eq(webhooks.id, row.id)).get()), secret: undefined } });
});

outgoingWebhookRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const row = await ownedWebhook(c.var.db, currentUser(c), c.req.param('id'));
  await c.var.db.delete(webhooks).where(eq(webhooks.id, row.id));
  return c.json({ ok: true });
});

outgoingWebhookRoutes.get('/:id/deliveries', requireScope('mail:read'), async (c) => {
  const row = await ownedWebhook(c.var.db, currentUser(c), c.req.param('id'));
  const rows = await c.var.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, row.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(50);
  return c.json({ items: rows });
});

outgoingWebhookRoutes.post('/:id/rotate-secret', requireScope('mail:write'), async (c) => {
  const row = await ownedWebhook(c.var.db, currentUser(c), c.req.param('id'));
  const secret = `whsec_${randomToken(32)}`;
  await c.var.db.update(webhooks).set({ secret }).where(eq(webhooks.id, row.id));
  return c.json({ secret });
});

// --- Web Push ----------------------------------------------------------------

export const pushRoutes = router();
pushRoutes.use('*', requireUser);

pushRoutes.get('/vapid', async (c) => {
  return c.json({ publicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null });
});

pushRoutes.get('/subscriptions', async (c) => {
  const user = currentUser(c);
  const rows = await c.var.db.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, userAgent: pushSubscriptions.userAgent, createdAt: pushSubscriptions.createdAt }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
  return c.json({ items: rows });
});

pushRoutes.post(
  '/subscribe',
  zValidator('json', z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })),
  async (c) => {
    const user = currentUser(c);
    if (!pushConfigured(c.env)) throw badRequest('push_unavailable', 'Web Push is not configured on this server.');
    const body = c.req.valid('json');
    const count = await c.var.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    if (count.length >= 10) throw badRequest('too_many_devices', 'You can register up to 10 devices for notifications.');
    await c.var.db
      .insert(pushSubscriptions)
      .values({ id: newId(), userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth } });
    return c.json({ ok: true });
  },
);

pushRoutes.delete('/subscribe', zValidator('json', z.object({ endpoint: z.string().url() })), async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, c.req.valid('json').endpoint)));
  return c.json({ ok: true });
});

pushRoutes.delete('/subscriptions/:id', async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.id, c.req.param('id'))));
  return c.json({ ok: true });
});
