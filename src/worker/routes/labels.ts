import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser, requireScope, requireUser } from '../auth/context';
import { labels } from '../db/schema';
import { newId } from '../lib/crypto';
import { conflict, notFound } from '../lib/http';
import { router } from './router';

export const labelRoutes = router();
labelRoutes.use('*', requireUser);

const labelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  parentId: z.string().nullable().optional(),
  visibility: z.enum(['show', 'hide', 'show_if_unread']).optional(),
  sortOrder: z.number().int().optional(),
});

labelRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const rows = await c.var.db.select().from(labels).where(eq(labels.userId, user.id)).orderBy(labels.sortOrder, labels.name);
  return c.json({ items: rows });
});

labelRoutes.post('/', requireScope('mail:write'), zValidator('json', labelSchema), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  const existing = await c.var.db.select().from(labels).where(and(eq(labels.userId, user.id), eq(labels.name, body.name))).get();
  if (existing) throw conflict('label_exists', 'A label with that name already exists.');
  const id = newId();
  await c.var.db.insert(labels).values({
    id,
    userId: user.id,
    name: body.name,
    color: body.color ?? pickColor(body.name),
    parentId: body.parentId ?? null,
    visibility: body.visibility ?? 'show',
    sortOrder: body.sortOrder ?? 0,
  });
  return c.json({ label: await c.var.db.select().from(labels).where(eq(labels.id, id)).get() }, 201);
});

labelRoutes.patch('/:id', requireScope('mail:write'), zValidator('json', labelSchema.partial()), async (c) => {
  const user = currentUser(c);
  const body = c.req.valid('json');
  const row = await c.var.db.select().from(labels).where(and(eq(labels.id, c.req.param('id')), eq(labels.userId, user.id))).get();
  if (!row) throw notFound('Label');
  if (body.name && body.name !== row.name) {
    const dup = await c.var.db.select().from(labels).where(and(eq(labels.userId, user.id), eq(labels.name, body.name))).get();
    if (dup) throw conflict('label_exists', 'A label with that name already exists.');
  }
  await c.var.db.update(labels).set(body).where(eq(labels.id, row.id));
  return c.json({ label: await c.var.db.select().from(labels).where(eq(labels.id, row.id)).get() });
});

labelRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  await c.var.db.delete(labels).where(and(eq(labels.id, c.req.param('id')), eq(labels.userId, user.id)));
  return c.json({ ok: true });
});

const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];

function pickColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
