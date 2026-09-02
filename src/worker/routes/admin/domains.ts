import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isValidEmail, normalizeEmail, splitAddress } from '../../../shared/address';
import { MAIL_PROVIDERS, MAILBOX_PERMISSIONS } from '../../../shared/types';
import { domains, mailboxAccess, mailboxAliases, mailboxes, messages, users, type Domain } from '../../db/schema';
import { baseUrl } from '../../env';
import { audit } from '../../lib/audit';
import { newId } from '../../lib/crypto';
import { badRequest, conflict, HttpError, notFound } from '../../lib/http';
import { defaultProviderKind, getProvider } from '../../mail/providers/registry';
import { ProviderError, type ProviderDomainInfo } from '../../mail/providers/types';
import { router } from '../router';

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export const adminDomainRoutes = router();

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function domainContext(c: { env: { APP_BASE_URL: string; EMAIL_WORKER_NAME: string } }) {
  return { appBaseUrl: baseUrl(c.env as never), workerName: c.env.EMAIL_WORKER_NAME || 'mailcove' };
}

function applyInfo(domain: Domain, info: ProviderDomainInfo): Partial<typeof domains.$inferInsert> {
  return {
    status: info.status,
    sendingEnabled: info.sendingEnabled,
    receivingEnabled: info.receivingEnabled,
    dnsRecords: info.records,
    providerDomainId: info.providerDomainId ?? domain.providerDomainId,
    zoneId: info.zoneId ?? domain.zoneId,
    lastCheckedAt: new Date(),
    verifiedAt: info.status === 'verified' ? (domain.verifiedAt ?? new Date()) : domain.verifiedAt,
    lastError: null,
    updatedAt: new Date(),
  };
}

adminDomainRoutes.get('/', async (c) => {
  const db = c.var.db;
  const rows = await db.select().from(domains).orderBy(asc(domains.name));
  const counts = await db.select({ domainId: mailboxes.domainId, n: sql<number>`count(*)` }).from(mailboxes).groupBy(mailboxes.domainId);
  return c.json({
    items: rows.map((d) => ({ ...d, mailboxCount: Number(counts.find((x) => x.domainId === d.id)?.n ?? 0) })),
    defaultProvider: defaultProviderKind(c.env),
  });
});

adminDomainRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      name: z.string().trim().toLowerCase().max(253),
      provider: z.enum(MAIL_PROVIDERS).optional(),
      /** Skip provider API calls; the operator wires DNS/routing by hand. */
      manual: z.boolean().optional(),
      unknownRecipientPolicy: z.enum(['unrouted', 'reject']).optional(),
    }),
  ),
  async (c) => {
    const db = c.var.db;
    const actor = c.var.principal!.user;
    const body = c.req.valid('json');
    const name = body.name.replace(/^@/, '');
    if (!DOMAIN_RE.test(name)) throw badRequest('invalid_domain', 'Enter a bare domain such as example.com.');
    if (await db.select({ id: domains.id }).from(domains).where(eq(domains.name, name)).get()) throw conflict('domain_exists', 'That domain is already connected.');
    const providerKind = body.provider ?? defaultProviderKind(c.env);
    const id = newId();
    await db.insert(domains).values({ id, name, provider: providerKind, unknownRecipientPolicy: body.unknownRecipientPolicy ?? 'unrouted', status: 'pending' });
    let notes: string[] = [];
    if (!body.manual) {
      try {
        const provider = await getProvider(c.env, db, providerKind);
        const info = await provider.createDomain(name, domainContext(c));
        const current = (await db.select().from(domains).where(eq(domains.id, id)).get())!;
        await db.update(domains).set(applyInfo(current, info)).where(eq(domains.id, id));
        notes = info.notes ?? [];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.update(domains).set({ lastError: message, lastCheckedAt: new Date() }).where(eq(domains.id, id));
        notes = [`Provider setup failed: ${message}. You can finish configuration manually and press "Re-check".`];
      }
    } else {
      notes = ['Manual mode: configure MX/SPF/DKIM and routing at your provider, then mark the domain verified.'];
    }
    await audit(db, { actorUserId: actor.id, action: 'admin.domain.create', targetType: 'domain', targetId: id, metadata: { name, provider: providerKind, manual: Boolean(body.manual) } });
    return c.json({ domain: await db.select().from(domains).where(eq(domains.id, id)).get(), notes }, 201);
  },
);

adminDomainRoutes.get('/:id', async (c) => {
  const db = c.var.db;
  const domain = await db.select().from(domains).where(eq(domains.id, c.req.param('id'))).get();
  if (!domain) throw notFound('Domain');
  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.domainId, domain.id)).orderBy(asc(mailboxes.address));
  return c.json({ domain, mailboxes: boxes });
});

adminDomainRoutes.post('/:id/verify', async (c) => {
  const db = c.var.db;
  const domain = await db.select().from(domains).where(eq(domains.id, c.req.param('id'))).get();
  if (!domain) throw notFound('Domain');
  try {
    const provider = await getProvider(c.env, db, domain.provider);
    const info = await provider.verifyDomain(domain.name, domain.providerDomainId, domainContext(c));
    await db.update(domains).set(applyInfo(domain, info)).where(eq(domains.id, domain.id));
    return c.json({ domain: await db.select().from(domains).where(eq(domains.id, domain.id)).get(), notes: info.notes ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(domains).set({ lastError: message, lastCheckedAt: new Date() }).where(eq(domains.id, domain.id));
    if (error instanceof ProviderError) throw new HttpError(400, error.code, message);
    throw error;
  }
});

/** Re-run provider onboarding (e.g. after adding a Cloudflare token). */
adminDomainRoutes.post('/:id/provision', async (c) => {
  const db = c.var.db;
  const domain = await db.select().from(domains).where(eq(domains.id, c.req.param('id'))).get();
  if (!domain) throw notFound('Domain');
  try {
    const provider = await getProvider(c.env, db, domain.provider);
    const info = await provider.createDomain(domain.name, domainContext(c));
    await db.update(domains).set(applyInfo(domain, info)).where(eq(domains.id, domain.id));
    await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.domain.provision', targetType: 'domain', targetId: domain.id });
    return c.json({ domain: await db.select().from(domains).where(eq(domains.id, domain.id)).get(), notes: info.notes ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(domains).set({ lastError: message, lastCheckedAt: new Date() }).where(eq(domains.id, domain.id));
    if (error instanceof ProviderError) throw new HttpError(400, error.code, message);
    throw error;
  }
});

adminDomainRoutes.patch(
  '/:id',
  zValidator(
    'json',
    z.object({
      catchallMailboxId: z.string().nullable().optional(),
      unknownRecipientPolicy: z.enum(['unrouted', 'reject']).optional(),
      provider: z.enum(MAIL_PROVIDERS).optional(),
      /** Manual override when the operator has confirmed DNS themselves. */
      status: z.enum(['pending', 'verified', 'failed']).optional(),
      sendingEnabled: z.boolean().optional(),
      receivingEnabled: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const db = c.var.db;
    const domain = await db.select().from(domains).where(eq(domains.id, c.req.param('id'))).get();
    if (!domain) throw notFound('Domain');
    const body = c.req.valid('json');
    if (body.catchallMailboxId) {
      const mailbox = await db.select().from(mailboxes).where(and(eq(mailboxes.id, body.catchallMailboxId), eq(mailboxes.domainId, domain.id))).get();
      if (!mailbox) throw badRequest('invalid_catchall', 'The catch-all mailbox must belong to this domain.');
    }
    await db
      .update(domains)
      .set({
        catchallMailboxId: body.catchallMailboxId === undefined ? domain.catchallMailboxId : body.catchallMailboxId,
        unknownRecipientPolicy: body.unknownRecipientPolicy ?? domain.unknownRecipientPolicy,
        provider: body.provider ?? domain.provider,
        status: body.status ?? domain.status,
        sendingEnabled: body.sendingEnabled ?? domain.sendingEnabled,
        receivingEnabled: body.receivingEnabled ?? domain.receivingEnabled,
        verifiedAt: body.status === 'verified' ? (domain.verifiedAt ?? new Date()) : domain.verifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, domain.id));
    await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.domain.update', targetType: 'domain', targetId: domain.id, metadata: body });
    return c.json({ domain: await db.select().from(domains).where(eq(domains.id, domain.id)).get() });
  },
);

adminDomainRoutes.delete('/:id', async (c) => {
  const db = c.var.db;
  const domain = await db.select().from(domains).where(eq(domains.id, c.req.param('id'))).get();
  if (!domain) throw notFound('Domain');
  const count = await db.select({ n: sql<number>`count(*)` }).from(mailboxes).where(eq(mailboxes.domainId, domain.id)).get();
  if (Number(count?.n ?? 0) > 0 && c.req.query('force') !== '1') {
    throw new HttpError(409, 'domain_has_mailboxes', 'Delete or move its mailboxes first, or pass ?force=1 to remove everything.');
  }
  if (c.req.query('detachProvider') === '1') {
    try {
      const provider = await getProvider(c.env, db, domain.provider);
      await provider.deleteDomain(domain.name, domain.providerDomainId, domainContext(c));
    } catch (error) {
      console.warn('provider deleteDomain failed', error);
    }
  }
  await db.delete(domains).where(eq(domains.id, domain.id));
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.domain.delete', targetType: 'domain', targetId: domain.id, metadata: { name: domain.name } });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

export const adminMailboxRoutes = router();

adminMailboxRoutes.get('/', async (c) => {
  const db = c.var.db;
  const rows = await db
    .select({ mailbox: mailboxes, domainName: domains.name, ownerName: users.name, ownerEmail: users.email })
    .from(mailboxes)
    .innerJoin(domains, eq(domains.id, mailboxes.domainId))
    .leftJoin(users, eq(users.id, mailboxes.ownerUserId))
    .orderBy(asc(mailboxes.address));
  const aliases = await db.select().from(mailboxAliases);
  const access = await db
    .select({ mailboxId: mailboxAccess.mailboxId, userId: mailboxAccess.userId, permission: mailboxAccess.permission, name: users.name, email: users.email })
    .from(mailboxAccess)
    .innerJoin(users, eq(users.id, mailboxAccess.userId));
  const stats = await db
    .select({ mailboxId: messages.mailboxId, count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)`, last: sql<number>`max(${messages.receivedAt})` })
    .from(messages)
    .groupBy(messages.mailboxId);
  return c.json({
    items: rows.map((r) => ({
      ...r.mailbox,
      domainName: r.domainName,
      owner: r.mailbox.ownerUserId ? { id: r.mailbox.ownerUserId, name: r.ownerName, email: r.ownerEmail } : null,
      aliases: aliases.filter((a) => a.mailboxId === r.mailbox.id),
      access: access.filter((a) => a.mailboxId === r.mailbox.id),
      messageCount: Number(stats.find((s) => s.mailboxId === r.mailbox.id)?.count ?? 0),
      storageBytes: Number(stats.find((s) => s.mailboxId === r.mailbox.id)?.bytes ?? 0),
      lastMessageAt: stats.find((s) => s.mailboxId === r.mailbox.id)?.last ?? null,
    })),
  });
});

const mailboxSchema = z.object({
  domainId: z.string(),
  localPart: z.string().trim().toLowerCase().min(1).max(64),
  displayName: z.string().trim().max(120).nullable().optional(),
  type: z.enum(['personal', 'shared']).default('personal'),
  ownerUserId: z.string().nullable().optional(),
});

adminMailboxRoutes.post('/', zValidator('json', mailboxSchema), async (c) => {
  const db = c.var.db;
  const body = c.req.valid('json');
  const domain = await db.select().from(domains).where(eq(domains.id, body.domainId)).get();
  if (!domain) throw notFound('Domain');
  if (!/^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?$/.test(body.localPart)) throw badRequest('invalid_local_part', 'Use letters, numbers, dots, hyphens or underscores.');
  const address = `${body.localPart}@${domain.name}`;
  if (await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.address, address)).get()) throw conflict('mailbox_taken', 'That address already exists.');
  if (await db.select({ id: mailboxAliases.id }).from(mailboxAliases).where(eq(mailboxAliases.address, address)).get()) throw conflict('alias_taken', 'That address is already used as an alias.');
  if (body.ownerUserId && !(await db.select({ id: users.id }).from(users).where(eq(users.id, body.ownerUserId)).get())) throw notFound('Owner user');
  const id = newId();
  await db.insert(mailboxes).values({
    id,
    domainId: domain.id,
    localPart: body.localPart,
    address,
    displayName: body.displayName ?? null,
    type: body.type,
    ownerUserId: body.ownerUserId ?? null,
  });
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.mailbox.create', targetType: 'mailbox', targetId: id, metadata: { address, type: body.type } });
  return c.json({ mailbox: await db.select().from(mailboxes).where(eq(mailboxes.id, id)).get() }, 201);
});

adminMailboxRoutes.patch(
  '/:id',
  zValidator('json', z.object({ displayName: z.string().trim().max(120).nullable().optional(), type: z.enum(['personal', 'shared']).optional(), ownerUserId: z.string().nullable().optional(), disabled: z.boolean().optional() })),
  async (c) => {
    const db = c.var.db;
    const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, c.req.param('id'))).get();
    if (!mailbox) throw notFound('Mailbox');
    const body = c.req.valid('json');
    if (body.ownerUserId && !(await db.select({ id: users.id }).from(users).where(eq(users.id, body.ownerUserId)).get())) throw notFound('Owner user');
    await db
      .update(mailboxes)
      .set({
        displayName: body.displayName === undefined ? mailbox.displayName : body.displayName,
        type: body.type ?? mailbox.type,
        ownerUserId: body.ownerUserId === undefined ? mailbox.ownerUserId : body.ownerUserId,
        disabled: body.disabled ?? mailbox.disabled,
      })
      .where(eq(mailboxes.id, mailbox.id));
    await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.mailbox.update', targetType: 'mailbox', targetId: mailbox.id, metadata: body });
    return c.json({ mailbox: await db.select().from(mailboxes).where(eq(mailboxes.id, mailbox.id)).get() });
  },
);

adminMailboxRoutes.delete('/:id', async (c) => {
  const db = c.var.db;
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, c.req.param('id'))).get();
  if (!mailbox) throw notFound('Mailbox');
  const keys = await db.select({ raw: messages.rawR2Key }).from(messages).where(eq(messages.mailboxId, mailbox.id));
  const attachmentKeys = await db.all<{ r2_key: string }>(sql`select a.r2_key from attachments a join messages m on m.id = a.message_id where m.mailbox_id = ${mailbox.id}`);
  const objects = [...keys.map((k) => k.raw).filter((k): k is string => Boolean(k)), ...attachmentKeys.map((k) => k.r2_key)];
  await db.delete(mailboxes).where(eq(mailboxes.id, mailbox.id));
  for (let i = 0; i < objects.length; i += 500) await c.env.STORAGE.delete(objects.slice(i, i + 500)).catch(() => undefined);
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.mailbox.delete', targetType: 'mailbox', targetId: mailbox.id, metadata: { address: mailbox.address, objects: objects.length } });
  return c.json({ ok: true });
});

adminMailboxRoutes.post('/:id/aliases', zValidator('json', z.object({ address: z.string().trim().max(254) })), async (c) => {
  const db = c.var.db;
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, c.req.param('id'))).get();
  if (!mailbox) throw notFound('Mailbox');
  const address = normalizeEmail(c.req.valid('json').address);
  if (!isValidEmail(address)) throw badRequest('invalid_alias');
  const { domain } = splitAddress(address);
  if (!(await db.select({ id: domains.id }).from(domains).where(eq(domains.name, domain)).get())) throw badRequest('domain_not_found', `Connect ${domain} before adding aliases on it.`);
  if (await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.address, address)).get()) throw conflict('mailbox_taken', 'A mailbox already uses that address.');
  const id = newId();
  await db.insert(mailboxAliases).values({ id, mailboxId: mailbox.id, address }).onConflictDoNothing();
  return c.json({ alias: await db.select().from(mailboxAliases).where(eq(mailboxAliases.address, address)).get() }, 201);
});

adminMailboxRoutes.delete('/:id/aliases/:aliasId', async (c) => {
  await c.var.db.delete(mailboxAliases).where(and(eq(mailboxAliases.id, c.req.param('aliasId')), eq(mailboxAliases.mailboxId, c.req.param('id'))));
  return c.json({ ok: true });
});

adminMailboxRoutes.put('/:id/access', zValidator('json', z.object({ userId: z.string(), permission: z.enum(MAILBOX_PERMISSIONS) })), async (c) => {
  const db = c.var.db;
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, c.req.param('id'))).get();
  if (!mailbox) throw notFound('Mailbox');
  const body = c.req.valid('json');
  if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)).get())) throw notFound('User');
  await db
    .insert(mailboxAccess)
    .values({ id: newId(), mailboxId: mailbox.id, userId: body.userId, permission: body.permission, createdByUserId: c.var.principal!.user.id })
    .onConflictDoUpdate({ target: [mailboxAccess.mailboxId, mailboxAccess.userId], set: { permission: body.permission } });
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.mailbox.access', targetType: 'mailbox', targetId: mailbox.id, metadata: body });
  return c.json({ ok: true });
});

adminMailboxRoutes.delete('/:id/access/:userId', async (c) => {
  await c.var.db.delete(mailboxAccess).where(and(eq(mailboxAccess.mailboxId, c.req.param('id')), eq(mailboxAccess.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});
