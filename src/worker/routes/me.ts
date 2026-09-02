import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { UserPrefs } from '../../shared/types';
import { accessibleMailboxes } from '../auth/access';
import { currentUser, isAdmin, requireUser } from '../auth/context';
import { labels, sessions, users } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/http';
import { pushConfigured } from '../lib/push';
import { getSettings } from '../lib/settings';
import { viewCounts } from '../mail/queries';
import { router } from './router';

export const meRoutes = router();
meRoutes.use('*', requireUser);

export function parsePrefs(raw: string | null | undefined): UserPrefs {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as UserPrefs;
  } catch {
    return {};
  }
}

meRoutes.get('/', async (c) => {
  const db = c.var.db;
  const user = currentUser(c);
  const [mailboxes, userLabels, settings] = await Promise.all([
    accessibleMailboxes(db, user),
    db.select().from(labels).where(eq(labels.userId, user.id)).orderBy(labels.sortOrder, labels.name),
    getSettings(db),
  ]);
  const counts = await viewCounts(
    db,
    mailboxes.map((m) => m.mailbox.id),
    user.id,
  );
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isAdmin: isAdmin(user),
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      avatarUrl: user.avatarKey ? `/api/me/avatar?v=${encodeURIComponent(user.avatarKey)}` : null,
      locale: user.locale ?? 'en',
      prefs: parsePrefs(user.prefs),
      createdAt: user.createdAt,
    },
    mailboxes: mailboxes.map((m) => ({
      id: m.mailbox.id,
      address: m.mailbox.address,
      displayName: m.mailbox.displayName,
      type: m.mailbox.type,
      domain: m.domainName,
      permission: m.permission,
      isOwner: m.isOwner,
      signatureHtml: m.mailbox.signatureHtml,
      vacation: m.mailbox.vacation,
      disabled: m.mailbox.disabled,
      avatarUrl: m.mailbox.avatarKey ? `/api/mailboxes/${m.mailbox.id}/avatar` : null,
    })),
    labels: userLabels,
    counts,
    settings: {
      appName: settings.appName,
      accentColor: settings.accentColor,
      logoUrl: settings.logoKey ? '/api/branding/logo' : null,
      defaultUndoSendSeconds: settings.defaultUndoSendSeconds,
      maxAttachmentBytes: settings.maxAttachmentBytes,
      maxMessageBytes: settings.maxMessageBytes,
      pushAvailable: pushConfigured(c.env),
      publicApiEnabled: settings.publicApiEnabled,
      inboundCategorization: settings.inboundCategorization,
    },
    apiKeyAuth: c.var.principal?.kind === 'api_key',
  });
});

meRoutes.get('/counts', async (c) => {
  const user = currentUser(c);
  const mailboxes = await accessibleMailboxes(c.var.db, user);
  return c.json(
    await viewCounts(
      c.var.db,
      mailboxes.map((m) => m.mailbox.id),
      user.id,
    ),
  );
});

const prefsSchema = z.object({
  density: z.enum(['default', 'comfortable', 'compact']).optional(),
  readingPane: z.enum(['right', 'bottom', 'off']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  undoSendSeconds: z.number().int().min(0).max(60).optional(),
  keyboardShortcuts: z.boolean().optional(),
  conversationView: z.boolean().optional(),
  categoryTabs: z.boolean().optional(),
  showImages: z.enum(['always', 'ask']).optional(),
  pageSize: z.number().int().min(10).max(100).optional(),
  defaultMailboxId: z.string().nullable().optional(),
  signatureOnReply: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
  soundOnNewMail: z.boolean().optional(),
});

meRoutes.patch(
  '/',
  zValidator('json', z.object({ name: z.string().trim().min(1).max(100).optional(), locale: z.string().max(10).optional(), prefs: prefsSchema.optional() })),
  async (c) => {
    const user = currentUser(c);
    const body = c.req.valid('json');
    const patch: Partial<typeof users.$inferInsert> = {};
    if (body.name) patch.name = body.name;
    if (body.locale) patch.locale = body.locale;
    if (body.prefs) patch.prefs = JSON.stringify({ ...parsePrefs(user.prefs), ...body.prefs });
    if (Object.keys(patch).length) await c.var.db.update(users).set(patch).where(eq(users.id, user.id));
    const fresh = await c.var.db.select().from(users).where(eq(users.id, user.id)).get();
    return c.json({ name: fresh?.name, locale: fresh?.locale, prefs: parsePrefs(fresh?.prefs) });
  },
);

meRoutes.get('/avatar', async (c) => {
  const user = currentUser(c);
  if (!user.avatarKey) throw notFound('Avatar');
  const object = await c.env.STORAGE.get(user.avatarKey);
  if (!object) throw notFound('Avatar');
  return new Response(object.body, {
    headers: { 'Content-Type': object.httpMetadata?.contentType ?? 'image/png', 'Cache-Control': 'private, max-age=3600' },
  });
});

meRoutes.post('/avatar', async (c) => {
  const user = currentUser(c);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('file_required');
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw badRequest('unsupported_type', 'Use a PNG, JPEG, WebP or GIF image.');
  if (file.size > 2 * 1024 * 1024) throw badRequest('too_large', 'Avatar must be under 2 MB.');
  const key = `avatars/users/${user.id}/${Date.now()}`;
  await c.env.STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (user.avatarKey) await c.env.STORAGE.delete(user.avatarKey).catch(() => undefined);
  await c.var.db.update(users).set({ avatarKey: key }).where(eq(users.id, user.id));
  return c.json({ avatarUrl: `/api/me/avatar?v=${encodeURIComponent(key)}` });
});

meRoutes.get('/sessions', async (c) => {
  const user = currentUser(c);
  const rows = await c.var.db.select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(desc(sessions.updatedAt));
  const currentId = c.var.principal?.kind === 'session' ? c.var.principal.sessionId : null;
  return c.json(
    rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt ?? s.updatedAt,
      expiresAt: s.expiresAt,
      current: s.id === currentId,
    })),
  );
});

meRoutes.delete('/sessions/:id', async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(sessions).where(and(eq(sessions.id, c.req.param('id')), eq(sessions.userId, user.id)));
  return c.json({ ok: true });
});

meRoutes.post('/sessions/revoke-others', async (c) => {
  const user = currentUser(c);
  const currentId = c.var.principal?.kind === 'session' ? c.var.principal.sessionId : '';
  await c.var.db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, currentId)));
  await audit(c.var.db, { actorUserId: user.id, action: 'sessions.revoke_others' });
  return c.json({ ok: true });
});
