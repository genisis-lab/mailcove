import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { domainOf, isValidEmail, normalizeEmail } from '../../shared/address';
import { currentUser, requireScope, requireUser } from '../auth/context';
import { blockedSenders, contacts, templates } from '../db/schema';
import { newId } from '../lib/crypto';
import { badRequest, notFound, parseIntParam } from '../lib/http';
import { router } from './router';

export const contactRoutes = router();
contactRoutes.use('*', requireUser);

contactRoutes.get('/', requireScope('contacts:read'), async (c) => {
  const user = currentUser(c);
  const q = c.req.query('q')?.trim().toLowerCase() ?? '';
  const limit = parseIntParam(c.req.query('limit'), 20, 200);
  const where = q
    ? and(eq(contacts.userId, user.id), or(like(contacts.email, `%${q}%`), like(sql`lower(${contacts.name})`, `%${q}%`)))
    : eq(contacts.userId, user.id);
  const rows = await c.var.db.select().from(contacts).where(where).orderBy(desc(contacts.frequency), desc(contacts.lastSeenAt)).limit(limit);
  return c.json({ items: rows });
});

const contactSchema = z.object({
  email: z.string().trim().max(254),
  name: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  alwaysShowImages: z.boolean().optional(),
});

contactRoutes.post('/', requireScope('mail:write'), zValidator('json', contactSchema), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) throw badRequest('invalid_email');
  await c.var.db
    .insert(contacts)
    .values({ id: newId(), userId: user.id, email, name: body.name ?? null, notes: body.notes ?? null, source: 'manual', alwaysShowImages: body.alwaysShowImages ?? false })
    .onConflictDoUpdate({
      target: [contacts.userId, contacts.email],
      set: { name: body.name ?? null, notes: body.notes ?? null, alwaysShowImages: body.alwaysShowImages ?? false, updatedAt: new Date() },
    });
  const row = await c.var.db.select().from(contacts).where(and(eq(contacts.userId, user.id), eq(contacts.email, email))).get();
  return c.json({ contact: row }, 201);
});

contactRoutes.patch('/:id', requireScope('mail:write'), zValidator('json', contactSchema.partial()), async (c) => {
  const user = currentUser(c);
  const row = await c.var.db.select().from(contacts).where(and(eq(contacts.id, c.req.param('id')), eq(contacts.userId, user.id))).get();
  if (!row) throw notFound('Contact');
  const body = c.req.valid('json');
  await c.var.db
    .update(contacts)
    .set({
      name: body.name === undefined ? row.name : body.name,
      notes: body.notes === undefined ? row.notes : body.notes,
      alwaysShowImages: body.alwaysShowImages ?? row.alwaysShowImages,
    })
    .where(eq(contacts.id, row.id));
  return c.json({ contact: await c.var.db.select().from(contacts).where(eq(contacts.id, row.id)).get() });
});

contactRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(contacts).where(and(eq(contacts.id, c.req.param('id')), eq(contacts.userId, user.id)));
  return c.json({ ok: true });
});

// --- Blocked senders -------------------------------------------------------

export const blockedRoutes = router();
blockedRoutes.use('*', requireUser);

blockedRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const rows = await c.var.db.select().from(blockedSenders).where(eq(blockedSenders.userId, user.id)).orderBy(desc(blockedSenders.createdAt));
  return c.json({ items: rows });
});

blockedRoutes.post('/', requireScope('mail:write'), zValidator('json', z.object({ pattern: z.string().trim().min(3).max(254), blockDomain: z.boolean().optional() })), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  let pattern = normalizeEmail(body.pattern);
  if (body.blockDomain) pattern = `@${pattern.startsWith('@') ? pattern.slice(1) : domainOf(pattern) || pattern}`;
  if (!pattern.startsWith('@') && !isValidEmail(pattern)) throw badRequest('invalid_pattern', 'Enter an email address or @domain.');
  await c.var.db.insert(blockedSenders).values({ id: newId(), userId: user.id, pattern }).onConflictDoNothing();
  const row = await c.var.db.select().from(blockedSenders).where(and(eq(blockedSenders.userId, user.id), eq(blockedSenders.pattern, pattern))).get();
  return c.json({ blocked: row }, 201);
});

blockedRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(blockedSenders).where(and(eq(blockedSenders.id, c.req.param('id')), eq(blockedSenders.userId, user.id)));
  return c.json({ ok: true });
});

// --- Templates (canned responses) -------------------------------------------

export const templateRoutes = router();
templateRoutes.use('*', requireUser);

const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().max(998).nullable().optional(),
  bodyHtml: z.string().max(200_000).default(''),
});

templateRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  return c.json({ items: await c.var.db.select().from(templates).where(eq(templates.userId, user.id)).orderBy(templates.name) });
});

templateRoutes.post('/', requireScope('mail:write'), zValidator('json', templateSchema), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  const id = newId();
  await c.var.db.insert(templates).values({ id, userId: user.id, name: body.name, subject: body.subject ?? null, bodyHtml: body.bodyHtml });
  return c.json({ template: await c.var.db.select().from(templates).where(eq(templates.id, id)).get() }, 201);
});

templateRoutes.patch('/:id', requireScope('mail:write'), zValidator('json', templateSchema.partial()), async (c) => {
  const user = currentUser(c);
  const row = await c.var.db.select().from(templates).where(and(eq(templates.id, c.req.param('id')), eq(templates.userId, user.id))).get();
  if (!row) throw notFound('Template');
  await c.var.db.update(templates).set(c.req.valid('json')).where(eq(templates.id, row.id));
  return c.json({ template: await c.var.db.select().from(templates).where(eq(templates.id, row.id)).get() });
});

templateRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(templates).where(and(eq(templates.id, c.req.param('id')), eq(templates.userId, user.id)));
  return c.json({ ok: true });
});
