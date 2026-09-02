import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAIL_PROVIDERS, type MailProviderKind } from '../../../shared/types';
import {
  auditLogs,
  backups,
  deadLetters,
  deliveryEvents,
  domains,
  mailboxes,
  messages,
  threads,
  unroutedMessages,
  users,
} from '../../db/schema';
import { baseUrl } from '../../env';
import { restoreBackup, runBackup, type BackupDocument } from '../../jobs/backup';
import { processIngestJob, type IngestJob } from '../../jobs/queue';
import { audit } from '../../lib/audit';
import { badRequest, HttpError, notFound, parseIntParam } from '../../lib/http';
import { pushConfigured } from '../../lib/push';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../../lib/settings';
import { ingestMail } from '../../mail/inbound/ingest';
import { deliverMessage } from '../../mail/outbound/deliver';
import { parseRawMail } from '../../mail/parse';
import { createResendProvider } from '../../mail/providers/resend';
import {
  buildProvider,
  describeConfiguredFields,
  PROVIDER_CAPABILITIES,
  resolveCredentials,
  storeCredentials,
} from '../../mail/providers/registry';
import { ProviderError } from '../../mail/providers/types';
import { router } from '../router';

// --- Overview ----------------------------------------------------------------

export const adminOverviewRoutes = router();

adminOverviewRoutes.get('/', async (c) => {
  const db = c.var.db;
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [userCount, domainCount, mailboxCount, threadCount, messageStats, inbound24, outbound24, failed7, unrouted, dead, recentDelivery, providersConfigured, latestBackup] =
    await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(users).get(),
      db.select({ n: sql<number>`count(*)`, verified: sql<number>`sum(case when ${domains.status} = 'verified' then 1 else 0 end)` }).from(domains).get(),
      db.select({ n: sql<number>`count(*)` }).from(mailboxes).get(),
      db.select({ n: sql<number>`count(*)` }).from(threads).get(),
      db.select({ n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)` }).from(messages).get(),
      db.select({ n: sql<number>`count(*)` }).from(messages).where(and(eq(messages.direction, 'inbound'), gte(messages.createdAt, dayAgo))).get(),
      db.select({ n: sql<number>`count(*)` }).from(messages).where(and(eq(messages.direction, 'outbound'), gte(messages.createdAt, dayAgo), eq(messages.isDraft, false))).get(),
      db.select({ n: sql<number>`count(*)` }).from(messages).where(and(sql`${messages.status} in ('failed','bounced')`, gte(messages.statusAt, weekAgo))).get(),
      db.select({ n: sql<number>`count(*)` }).from(unroutedMessages).where(isNull(unroutedMessages.resolvedAt)).get(),
      db.select({ n: sql<number>`count(*)` }).from(deadLetters).where(isNull(deadLetters.retriedAt)).get(),
      db.select().from(deliveryEvents).orderBy(desc(deliveryEvents.createdAt)).limit(10),
      Promise.all(
        MAIL_PROVIDERS.map(async (kind) => {
          const creds = await resolveCredentials(c.env, db, kind);
          return { kind, configured: buildProvider(c.env, kind, creds).isConfigured() };
        }),
      ),
      db.select().from(backups).orderBy(desc(backups.createdAt)).limit(1).get(),
    ]);
  const volume = await db.all<{ day: string; inbound: number; outbound: number }>(sql`
    select date(${messages.createdAt} / 1000, 'unixepoch') as day,
      sum(case when ${messages.direction} = 'inbound' then 1 else 0 end) as inbound,
      sum(case when ${messages.direction} = 'outbound' and ${messages.isDraft} = 0 then 1 else 0 end) as outbound
    from ${messages}
    where ${messages.createdAt} >= ${Date.now() - 14 * 24 * 3600 * 1000}
    group by day order by day`);
  return c.json({
    users: Number(userCount?.n ?? 0),
    domains: { total: Number(domainCount?.n ?? 0), verified: Number(domainCount?.verified ?? 0) },
    mailboxes: Number(mailboxCount?.n ?? 0),
    threads: Number(threadCount?.n ?? 0),
    messages: Number(messageStats?.n ?? 0),
    storageBytes: Number(messageStats?.bytes ?? 0),
    last24h: { inbound: Number(inbound24?.n ?? 0), outbound: Number(outbound24?.n ?? 0) },
    failedLast7d: Number(failed7?.n ?? 0),
    unrouted: Number(unrouted?.n ?? 0),
    deadLetters: Number(dead?.n ?? 0),
    recentDelivery,
    providers: providersConfigured,
    latestBackup: latestBackup ?? null,
    volume,
    health: {
      authSecret: Boolean(c.env.AUTH_SECRET && c.env.AUTH_SECRET.length >= 16),
      encryptionKey: Boolean(c.env.ENCRYPTION_KEY),
      sendEmailBinding: Boolean(c.env.EMAIL),
      queues: Boolean(c.env.INBOUND_QUEUE && c.env.OUTBOUND_QUEUE),
      push: pushConfigured(c.env),
      workerName: c.env.EMAIL_WORKER_NAME,
      baseUrl: baseUrl(c.env),
    },
  });
});

// --- Providers ---------------------------------------------------------------

export const adminProviderRoutes = router();

adminProviderRoutes.get('/', async (c) => {
  const db = c.var.db;
  const items = await Promise.all(
    MAIL_PROVIDERS.map(async (kind) => {
      const caps = PROVIDER_CAPABILITIES[kind];
      const creds = await resolveCredentials(c.env, db, kind);
      const provider = buildProvider(c.env, kind, creds);
      const domainCount = await db.select({ n: sql<number>`count(*)` }).from(domains).where(eq(domains.provider, kind)).get();
      return {
        kind,
        capabilities: caps,
        configured: provider.isConfigured(),
        fields: describeConfiguredFields(kind, creds),
        fromEnv: Object.fromEntries(caps.credentialFields.map((f) => [f.name, Boolean((c.env as unknown as Record<string, string | undefined>)[f.name])])),
        webhookUrl: caps.webhookPath ? `${baseUrl(c.env)}${caps.webhookPath}` : null,
        domainCount: Number(domainCount?.n ?? 0),
      };
    }),
  );
  return c.json({ items, encryptionKeyConfigured: Boolean(c.env.ENCRYPTION_KEY), defaultProvider: c.env.DEFAULT_MAIL_PROVIDER });
});

adminProviderRoutes.put('/:kind/credentials', zValidator('json', z.record(z.string(), z.string().max(4000))), async (c) => {
  const kind = c.req.param('kind') as MailProviderKind;
  if (!(MAIL_PROVIDERS as readonly string[]).includes(kind)) throw notFound('Provider');
  if (!c.env.ENCRYPTION_KEY) throw new HttpError(400, 'encryption_key_missing', 'Set the ENCRYPTION_KEY secret to store credentials in the admin panel (or use wrangler secrets).');
  const allowed = new Set(PROVIDER_CAPABILITIES[kind].credentialFields.map((f) => f.name));
  const body = c.req.valid('json');
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) if (allowed.has(key)) values[key] = value;
  await storeCredentials(c.env, c.var.db, kind, values, c.var.principal!.user.id);
  await audit(c.var.db, { actorUserId: c.var.principal!.user.id, action: 'admin.provider.credentials', targetType: 'provider', targetId: kind, metadata: { fields: Object.keys(values) } });
  const creds = await resolveCredentials(c.env, c.var.db, kind);
  return c.json({ configured: buildProvider(c.env, kind, creds).isConfigured(), fields: describeConfiguredFields(kind, creds) });
});

adminProviderRoutes.post('/:kind/test', zValidator('json', z.object({ from: z.string().email(), to: z.string().email() })), async (c) => {
  const kind = c.req.param('kind') as MailProviderKind;
  if (!(MAIL_PROVIDERS as readonly string[]).includes(kind)) throw notFound('Provider');
  const body = c.req.valid('json');
  const provider = buildProvider(c.env, kind, await resolveCredentials(c.env, c.var.db, kind));
  try {
    const result = await provider.send({
      from: { email: body.from, name: 'Mailcove' },
      to: [{ email: body.to, name: null }],
      cc: [],
      bcc: [],
      subject: `Mailcove test message via ${PROVIDER_CAPABILITIES[kind].label}`,
      text: `This is a test message sent from Mailcove at ${new Date().toISOString()} using the ${PROVIDER_CAPABILITIES[kind].label} provider.`,
      html: `<p>This is a test message sent from <strong>Mailcove</strong> at ${new Date().toISOString()} using the ${PROVIDER_CAPABILITIES[kind].label} provider.</p>`,
      headers: {},
      attachments: [],
      idempotencyKey: `test-${crypto.randomUUID()}`,
    });
    await audit(c.var.db, { actorUserId: c.var.principal!.user.id, action: 'admin.provider.test', targetType: 'provider', targetId: kind, metadata: body });
    return c.json({ ok: true, result });
  } catch (error) {
    if (error instanceof ProviderError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, 400);
    throw error;
  }
});

/** Creates the Resend inbound/delivery webhook and stores its signing secret. */
adminProviderRoutes.post('/resend/webhook', async (c) => {
  const creds = await resolveCredentials(c.env, c.var.db, 'resend');
  const provider = createResendProvider(creds);
  try {
    const result = await provider.createWebhook(baseUrl(c.env));
    if (result.secret && c.env.ENCRYPTION_KEY) {
      await storeCredentials(c.env, c.var.db, 'resend', { RESEND_WEBHOOK_SECRET: result.secret }, c.var.principal!.user.id);
    }
    return c.json({ id: result.id, secret: result.secret, stored: Boolean(result.secret && c.env.ENCRYPTION_KEY) });
  } catch (error) {
    if (error instanceof ProviderError) throw new HttpError(400, error.code, error.message);
    throw error;
  }
});

// --- Unrouted mail -------------------------------------------------------------

export const adminUnroutedRoutes = router();

adminUnroutedRoutes.get('/', async (c) => {
  const rows = await c.var.db
    .select()
    .from(unroutedMessages)
    .where(c.req.query('all') === '1' ? undefined : isNull(unroutedMessages.resolvedAt))
    .orderBy(desc(unroutedMessages.createdAt))
    .limit(parseIntParam(c.req.query('limit'), 100, 500));
  return c.json({ items: rows });
});

/** Re-delivers an unrouted message into a mailbox (typically one just created for it). */
adminUnroutedRoutes.post('/:id/deliver', zValidator('json', z.object({ mailboxId: z.string() })), async (c) => {
  const db = c.var.db;
  const row = await db.select().from(unroutedMessages).where(eq(unroutedMessages.id, c.req.param('id'))).get();
  if (!row) throw notFound('Unrouted message');
  if (!row.rawR2Key) throw badRequest('no_raw', 'The original message content is not available for this entry.');
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, c.req.valid('json').mailboxId)).get();
  if (!mailbox) throw notFound('Mailbox');
  const object = await c.env.STORAGE.get(row.rawR2Key);
  if (!object) throw badRequest('raw_missing', 'The stored message is gone from storage.');
  const parsed = await parseRawMail(await object.arrayBuffer());
  await ingestMail(c.env, db, parsed, {
    provider: row.provider ?? 'cloudflare',
    providerMessageId: row.providerMessageId ?? `unrouted-${row.id}`,
    envelopeFrom: row.envelopeFrom,
    envelopeTo: [mailbox.address],
    rawKey: row.rawR2Key,
  });
  await db.update(unroutedMessages).set({ resolvedAt: new Date() }).where(eq(unroutedMessages.id, row.id));
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.unrouted.deliver', targetType: 'unrouted', targetId: row.id, metadata: { mailbox: mailbox.address } });
  return c.json({ ok: true });
});

adminUnroutedRoutes.get('/:id/raw', async (c) => {
  const row = await c.var.db.select().from(unroutedMessages).where(eq(unroutedMessages.id, c.req.param('id'))).get();
  if (!row?.rawR2Key) throw notFound('Raw message');
  const object = await c.env.STORAGE.get(row.rawR2Key);
  if (!object) throw notFound('Raw message');
  return new Response(object.body, { headers: { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="unrouted-${row.id}.eml"` } });
});

adminUnroutedRoutes.delete('/:id', async (c) => {
  const db = c.var.db;
  const row = await db.select().from(unroutedMessages).where(eq(unroutedMessages.id, c.req.param('id'))).get();
  if (!row) throw notFound('Unrouted message');
  if (row.rawR2Key) await c.env.STORAGE.delete(row.rawR2Key).catch(() => undefined);
  await db.delete(unroutedMessages).where(eq(unroutedMessages.id, row.id));
  return c.json({ ok: true });
});

// --- Delivery log, audit log -----------------------------------------------------

export const adminLogRoutes = router();

adminLogRoutes.get('/delivery', async (c) => {
  const db = c.var.db;
  const limit = parseIntParam(c.req.query('limit'), 100, 500);
  const type = c.req.query('type');
  const rows = await db
    .select({ event: deliveryEvents, subject: messages.subject, to: messages.to, from: messages.fromAddr, mailboxId: messages.mailboxId, threadId: messages.threadId })
    .from(deliveryEvents)
    .leftJoin(messages, eq(messages.id, deliveryEvents.messageId))
    .where(type ? eq(deliveryEvents.type, type) : undefined)
    .orderBy(desc(deliveryEvents.createdAt))
    .limit(limit);
  const outbound = await db
    .select()
    .from(messages)
    .where(and(eq(messages.direction, 'outbound'), eq(messages.isDraft, false)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return c.json({ events: rows, outbound: outbound.map((m) => ({ ...m, textBody: undefined, htmlBody: undefined })) });
});

adminLogRoutes.get('/audit', async (c) => {
  const db = c.var.db;
  const limit = parseIntParam(c.req.query('limit'), 100, 500);
  const action = c.req.query('action');
  const rows = await db
    .select({ log: auditLogs, actorName: users.name, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(action ? sql`${auditLogs.action} like ${action + '%'}` : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return c.json({ items: rows.map((r) => ({ ...r.log, actorName: r.actorName, actorEmail: r.actorEmail })) });
});

// --- Dead letters ---------------------------------------------------------------

export const adminDeadLetterRoutes = router();

adminDeadLetterRoutes.get('/', async (c) => {
  const rows = await c.var.db.select().from(deadLetters).orderBy(desc(deadLetters.createdAt)).limit(200);
  return c.json({ items: rows });
});

adminDeadLetterRoutes.post('/:id/retry', async (c) => {
  const db = c.var.db;
  const row = await db.select().from(deadLetters).where(eq(deadLetters.id, c.req.param('id'))).get();
  if (!row) throw notFound('Dead letter');
  const body = JSON.parse(row.body) as IngestJob | { type: 'send'; messageId: string };
  try {
    if (body.type === 'ingest') await processIngestJob(c.env, db, body);
    else if (body.type === 'send') {
      await db.update(messages).set({ status: 'queued', statusAt: new Date() }).where(eq(messages.id, body.messageId));
      await deliverMessage(c.env, db, body.messageId);
    }
    await db.update(deadLetters).set({ retriedAt: new Date(), error: null }).where(eq(deadLetters.id, row.id));
    return c.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(deadLetters).set({ error: message, attempts: row.attempts + 1 }).where(eq(deadLetters.id, row.id));
    return c.json({ ok: false, error: message }, 400);
  }
});

adminDeadLetterRoutes.delete('/:id', async (c) => {
  await c.var.db.delete(deadLetters).where(eq(deadLetters.id, c.req.param('id')));
  return c.json({ ok: true });
});

// --- Backups --------------------------------------------------------------------

export const adminBackupRoutes = router();

adminBackupRoutes.get('/', async (c) => {
  const rows = await c.var.db.select().from(backups).orderBy(desc(backups.createdAt)).limit(100);
  const settings = await getSettings(c.var.db);
  return c.json({ items: rows, enabled: settings.backupsEnabled, retention: settings.backupRetentionCount });
});

adminBackupRoutes.post('/', async (c) => {
  const backup = await runBackup(c.env, c.var.db, 'manual');
  await audit(c.var.db, { actorUserId: c.var.principal!.user.id, action: 'admin.backup.run', targetType: 'backup', targetId: backup.id, metadata: { status: backup.status } });
  return c.json({ backup }, backup.status === 'failed' ? 500 : 201);
});

adminBackupRoutes.get('/:id/download', async (c) => {
  const row = await c.var.db.select().from(backups).where(eq(backups.id, c.req.param('id'))).get();
  if (!row?.r2Key) throw notFound('Backup');
  const object = await c.env.STORAGE.get(row.r2Key);
  if (!object) throw notFound('Backup');
  return new Response(object.body, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${row.filename ?? 'backup.json'}"` } });
});

adminBackupRoutes.delete('/:id', async (c) => {
  const row = await c.var.db.select().from(backups).where(eq(backups.id, c.req.param('id'))).get();
  if (!row) throw notFound('Backup');
  if (row.r2Key) await c.env.STORAGE.delete(row.r2Key).catch(() => undefined);
  await c.var.db.delete(backups).where(eq(backups.id, row.id));
  return c.json({ ok: true });
});

adminBackupRoutes.post('/restore', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const confirm = form.get('confirm');
  if (!(file instanceof File)) throw badRequest('file_required');
  if (confirm !== 'RESTORE') throw badRequest('confirmation_required', 'Type RESTORE to confirm. This replaces all current data.');
  const doc = JSON.parse(await file.text()) as BackupDocument;
  const counts = await restoreBackup(c.env.DB, doc);
  await audit(c.var.db, { actorUserId: c.var.principal!.user.id, action: 'admin.backup.restore', metadata: { tables: Object.keys(counts).length } });
  return c.json({ ok: true, counts });
});

// --- Settings & branding ----------------------------------------------------------

export const adminSettingsRoutes = router();

const settingsSchema = z.object({
  appName: z.string().trim().min(1).max(60).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  allowSignups: z.boolean().optional(),
  trashRetentionDays: z.number().int().min(0).max(3650).optional(),
  spamRetentionDays: z.number().int().min(0).max(3650).optional(),
  maxAttachmentBytes: z.number().int().min(1024).max(100 * 1024 * 1024).optional(),
  maxMessageBytes: z.number().int().min(1024).max(100 * 1024 * 1024).optional(),
  defaultUndoSendSeconds: z.number().int().min(0).max(60).optional(),
  requireTwoFactorForAdmins: z.boolean().optional(),
  backupsEnabled: z.boolean().optional(),
  backupRetentionCount: z.number().int().min(1).max(365).optional(),
  publicApiEnabled: z.boolean().optional(),
  inboundCategorization: z.boolean().optional(),
});

adminSettingsRoutes.get('/', async (c) => {
  return c.json({ settings: await getSettings(c.var.db), defaults: DEFAULT_SETTINGS });
});

adminSettingsRoutes.patch('/', zValidator('json', settingsSchema), async (c) => {
  const body = c.req.valid('json');
  const settings = await setSettings(c.var.db, body);
  await audit(c.var.db, { actorUserId: c.var.principal!.user.id, action: 'admin.settings.update', metadata: body });
  return c.json({ settings });
});

adminSettingsRoutes.post('/logo', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('file_required');
  if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) throw badRequest('unsupported_type', 'Use PNG, JPEG, WebP, GIF or SVG.');
  if (file.size > 1024 * 1024) throw badRequest('too_large', 'Logo must be under 1 MB.');
  const settings = await getSettings(c.var.db);
  const key = `branding/logo-${Date.now()}`;
  await c.env.STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (settings.logoKey) await c.env.STORAGE.delete(settings.logoKey).catch(() => undefined);
  await setSettings(c.var.db, { logoKey: key });
  return c.json({ logoUrl: `/api/branding/logo?v=${Date.now()}` });
});

adminSettingsRoutes.delete('/logo', async (c) => {
  const settings = await getSettings(c.var.db);
  if (settings.logoKey) await c.env.STORAGE.delete(settings.logoKey).catch(() => undefined);
  await setSettings(c.var.db, { logoKey: null });
  return c.json({ ok: true });
});

/** Storage report by mailbox and by age, to help operators size retention. */
adminSettingsRoutes.get('/storage', async (c) => {
  const db = c.var.db;
  const byMailbox = await db
    .select({ mailboxId: messages.mailboxId, address: mailboxes.address, count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)` })
    .from(messages)
    .innerJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
    .groupBy(messages.mailboxId)
    .orderBy(desc(sql`sum(${messages.sizeBytes})`))
    .limit(50);
  const olderThanYear = await db.select({ n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)` }).from(messages).where(lt(messages.receivedAt, new Date(Date.now() - 365 * 24 * 3600 * 1000))).get();
  return c.json({ byMailbox, olderThanYear: { count: Number(olderThanYear?.n ?? 0), bytes: Number(olderThanYear?.bytes ?? 0) } });
});
