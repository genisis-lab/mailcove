import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CATEGORIES } from '../../shared/types';
import { requireMailbox } from '../auth/access';
import { currentUser, requireScope, requireUser } from '../auth/context';
import { filters } from '../db/schema';
import { newId } from '../lib/crypto';
import { notFound } from '../lib/http';
import { router } from './router';

export const filterRoutes = router();
filterRoutes.use('*', requireUser);

const conditionSchema = z.object({
  field: z.enum(['from', 'to', 'subject', 'body', 'has_attachment', 'size_gt', 'size_lt', 'list_id', 'header']),
  operator: z.enum(['contains', 'not_contains', 'equals', 'starts_with', 'ends_with', 'matches']).optional(),
  value: z.string().max(500).optional(),
  header: z.string().max(100).optional(),
});

const actionsSchema = z.object({
  skipInbox: z.boolean().optional(),
  markRead: z.boolean().optional(),
  star: z.boolean().optional(),
  labelIds: z.array(z.string()).max(20).optional(),
  forwardTo: z.string().trim().email().optional().or(z.literal('')),
  markSpam: z.boolean().optional(),
  neverSpam: z.boolean().optional(),
  trash: z.boolean().optional(),
  category: z.enum(CATEGORIES).optional(),
  markImportant: z.boolean().optional(),
});

const filterSchema = z.object({
  name: z.string().trim().max(100).optional().nullable(),
  mailboxId: z.string().nullable().optional(),
  matchType: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).min(1).max(20),
  actions: actionsSchema,
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().optional(),
});

filterRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const rows = await c.var.db.select().from(filters).where(eq(filters.userId, user.id)).orderBy(filters.sortOrder, filters.createdAt);
  return c.json({ items: rows });
});

filterRoutes.post('/', requireScope('mail:write'), zValidator('json', filterSchema), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  if (body.mailboxId) await requireMailbox(c.var.db, user, body.mailboxId, 'full_access');
  const id = newId();
  const actions = { ...body.actions };
  if (actions.forwardTo === '') delete actions.forwardTo;
  await c.var.db.insert(filters).values({
    id,
    userId: user.id,
    mailboxId: body.mailboxId ?? null,
    name: body.name ?? null,
    matchType: body.matchType,
    conditions: body.conditions,
    actions,
    enabled: body.enabled,
    sortOrder: body.sortOrder ?? Date.now(),
  });
  return c.json({ filter: await c.var.db.select().from(filters).where(eq(filters.id, id)).get() }, 201);
});

filterRoutes.patch('/:id', requireScope('mail:write'), zValidator('json', filterSchema.partial()), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  const row = await c.var.db.select().from(filters).where(and(eq(filters.id, c.req.param('id')), eq(filters.userId, user.id))).get();
  if (!row) throw notFound('Filter');
  if (body.mailboxId) await requireMailbox(c.var.db, user, body.mailboxId, 'full_access');
  const actions = body.actions ? { ...body.actions } : undefined;
  if (actions && actions.forwardTo === '') delete actions.forwardTo;
  await c.var.db
    .update(filters)
    .set({ ...body, actions: actions ?? row.actions, mailboxId: body.mailboxId === undefined ? row.mailboxId : body.mailboxId })
    .where(eq(filters.id, row.id));
  return c.json({ filter: await c.var.db.select().from(filters).where(eq(filters.id, row.id)).get() });
});

filterRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(filters).where(and(eq(filters.id, c.req.param('id')), eq(filters.userId, user.id)));
  return c.json({ ok: true });
});
