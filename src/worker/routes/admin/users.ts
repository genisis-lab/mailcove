import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isValidEmail, normalizeEmail, splitAddress } from '../../../shared/address';
import { hashPassword } from '../../auth/password';
import { accounts, apiKeys, domains, mailboxAccess, mailboxes, messages, sessions, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { newId } from '../../lib/crypto';
import { badRequest, clientIp, conflict, HttpError, notFound } from '../../lib/http';
import { router } from '../router';

export const adminUserRoutes = router();

/** better-auth's synthetic issuer for email/password accounts. */
const CREDENTIAL_ISSUER = 'local:credential';

adminUserRoutes.get('/', async (c) => {
  const db = c.var.db;
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  const mailboxCounts = await db
    .select({ ownerUserId: mailboxes.ownerUserId, count: sql<number>`count(*)` })
    .from(mailboxes)
    .groupBy(mailboxes.ownerUserId);
  const sessionCounts = await db.select({ userId: sessions.userId, count: sql<number>`count(*)` }).from(sessions).groupBy(sessions.userId);
  const storage = await db
    .select({ ownerUserId: mailboxes.ownerUserId, bytes: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)` })
    .from(messages)
    .innerJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
    .groupBy(mailboxes.ownerUserId);
  return c.json({
    items: rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role ?? 'user',
      disabled: Boolean(u.disabled),
      banned: Boolean(u.banned),
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
      createdAt: u.createdAt,
      mailboxCount: Number(mailboxCounts.find((m) => m.ownerUserId === u.id)?.count ?? 0),
      sessionCount: Number(sessionCounts.find((s) => s.userId === u.id)?.count ?? 0),
      storageBytes: Number(storage.find((s) => s.ownerUserId === u.id)?.bytes ?? 0),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(256),
  role: z.enum(['admin', 'user']).default('user'),
  /** Optional mailbox to create for the user, e.g. jane@example.com */
  mailboxAddress: z.string().trim().max(254).optional().nullable(),
  mailboxDisplayName: z.string().trim().max(120).optional().nullable(),
});

adminUserRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const db = c.var.db;
  const actor = c.var.principal!.user;
  const body = c.req.valid('json');
  const email = body.email.toLowerCase();
  if (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) throw conflict('email_taken', 'A user with that email already exists.');

  let mailboxDomain: typeof domains.$inferSelect | undefined;
  let mailboxAddress: string | null = null;
  if (body.mailboxAddress) {
    mailboxAddress = normalizeEmail(body.mailboxAddress);
    if (!isValidEmail(mailboxAddress)) throw badRequest('invalid_mailbox', 'Mailbox address is not valid.');
    const { domain } = splitAddress(mailboxAddress);
    mailboxDomain = await db.select().from(domains).where(eq(domains.name, domain)).get();
    if (!mailboxDomain) throw badRequest('domain_not_found', `Add the domain ${domain} before creating mailboxes on it.`);
    if (await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.address, mailboxAddress)).get()) {
      throw conflict('mailbox_taken', 'That mailbox address already exists.');
    }
  }

  const userId = newId();
  const now = new Date();
  await db.insert(users).values({ id: userId, name: body.name, email, emailVerified: true, role: body.role, createdAt: now, updatedAt: now });
  await db.insert(accounts).values({
    id: newId(),
    issuer: CREDENTIAL_ISSUER,
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(body.password),
    createdAt: now,
    updatedAt: now,
  });
  let mailbox = null;
  if (mailboxDomain && mailboxAddress) {
    const { localPart } = splitAddress(mailboxAddress);
    const id = newId();
    await db.insert(mailboxes).values({
      id,
      domainId: mailboxDomain.id,
      localPart,
      address: mailboxAddress,
      displayName: body.mailboxDisplayName ?? body.name,
      type: 'personal',
      ownerUserId: userId,
    });
    mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).get();
  }
  await audit(db, { actorUserId: actor.id, action: 'admin.user.create', targetType: 'user', targetId: userId, metadata: { email, role: body.role, mailbox: mailboxAddress }, ip: clientIp(c) });
  return c.json({ user: await db.select().from(users).where(eq(users.id, userId)).get(), mailbox }, 201);
});

adminUserRoutes.get('/:id', async (c) => {
  const db = c.var.db;
  const user = await db.select().from(users).where(eq(users.id, c.req.param('id'))).get();
  if (!user) throw notFound('User');
  const owned = await db.select().from(mailboxes).where(eq(mailboxes.ownerUserId, user.id));
  const shared = await db
    .select({ mailbox: mailboxes, permission: mailboxAccess.permission })
    .from(mailboxAccess)
    .innerJoin(mailboxes, eq(mailboxes.id, mailboxAccess.mailboxId))
    .where(eq(mailboxAccess.userId, user.id));
  const keys = await db.select({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt }).from(apiKeys).where(eq(apiKeys.userId, user.id));
  const sess = await db.select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(desc(sessions.updatedAt));
  return c.json({ user: { ...user, prefs: undefined }, mailboxes: owned, shared, apiKeys: keys, sessions: sess });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
});

adminUserRoutes.patch('/:id', zValidator('json', patchSchema), async (c) => {
  const db = c.var.db;
  const actor = c.var.principal!.user;
  const target = await db.select().from(users).where(eq(users.id, c.req.param('id'))).get();
  if (!target) throw notFound('User');
  const body = c.req.valid('json');
  if ((body.role === 'user' || body.disabled) && target.role === 'admin') {
    const otherAdmins = await db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.role, 'admin'), ne(users.id, target.id), eq(users.disabled, false)))
      .get();
    if (Number(otherAdmins?.n ?? 0) === 0) throw new HttpError(409, 'last_admin', 'You cannot demote or disable the last administrator.');
  }
  if (body.disabled && target.id === actor.id) throw badRequest('self_disable', 'You cannot disable your own account.');
  await db.update(users).set(body).where(eq(users.id, target.id));
  if (body.disabled) await db.delete(sessions).where(eq(sessions.userId, target.id));
  await audit(db, { actorUserId: actor.id, action: 'admin.user.update', targetType: 'user', targetId: target.id, metadata: body, ip: clientIp(c) });
  return c.json({ user: await db.select().from(users).where(eq(users.id, target.id)).get() });
});

adminUserRoutes.post('/:id/password', zValidator('json', z.object({ password: z.string().min(10).max(256) })), async (c) => {
  const db = c.var.db;
  const actor = c.var.principal!.user;
  const target = await db.select().from(users).where(eq(users.id, c.req.param('id'))).get();
  if (!target) throw notFound('User');
  const hash = await hashPassword(c.req.valid('json').password);
  const credential = await db.select().from(accounts).where(and(eq(accounts.userId, target.id), eq(accounts.providerId, 'credential'))).get();
  if (credential) await db.update(accounts).set({ password: hash, updatedAt: new Date() }).where(eq(accounts.id, credential.id));
  else await db.insert(accounts).values({ id: newId(), issuer: CREDENTIAL_ISSUER, accountId: target.id, providerId: 'credential', userId: target.id, password: hash, createdAt: new Date(), updatedAt: new Date() });
  await db.delete(sessions).where(eq(sessions.userId, target.id));
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.userId, target.id));
  await audit(db, { actorUserId: actor.id, action: 'admin.user.reset_password', targetType: 'user', targetId: target.id, ip: clientIp(c) });
  return c.json({ ok: true });
});

adminUserRoutes.post('/:id/revoke-sessions', async (c) => {
  const db = c.var.db;
  await db.delete(sessions).where(eq(sessions.userId, c.req.param('id')));
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.user.revoke_sessions', targetType: 'user', targetId: c.req.param('id') });
  return c.json({ ok: true });
});

adminUserRoutes.post('/:id/disable-2fa', async (c) => {
  const db = c.var.db;
  const target = await db.select().from(users).where(eq(users.id, c.req.param('id'))).get();
  if (!target) throw notFound('User');
  await db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, target.id));
  await db.run(sql`delete from two_factor where user_id = ${target.id}`);
  await audit(db, { actorUserId: c.var.principal!.user.id, action: 'admin.user.disable_2fa', targetType: 'user', targetId: target.id });
  return c.json({ ok: true });
});

adminUserRoutes.delete('/:id', async (c) => {
  const db = c.var.db;
  const actor = c.var.principal!.user;
  const target = await db.select().from(users).where(eq(users.id, c.req.param('id'))).get();
  if (!target) throw notFound('User');
  if (target.id === actor.id) throw badRequest('self_delete', 'You cannot delete your own account.');
  if (target.role === 'admin') {
    const others = await db.select({ n: sql<number>`count(*)` }).from(users).where(and(eq(users.role, 'admin'), ne(users.id, target.id))).get();
    if (Number(others?.n ?? 0) === 0) throw new HttpError(409, 'last_admin', 'You cannot delete the last administrator.');
  }
  // Mailboxes survive (ownerless) so mail is not lost; reassign them afterwards.
  await db.update(mailboxes).set({ ownerUserId: null }).where(eq(mailboxes.ownerUserId, target.id));
  await db.delete(users).where(eq(users.id, target.id));
  await audit(db, { actorUserId: actor.id, action: 'admin.user.delete', targetType: 'user', targetId: target.id, metadata: { email: target.email }, ip: clientIp(c) });
  return c.json({ ok: true });
});
