import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { parseSearchQuery } from '../../shared/search-query';
import { CATEGORIES, VIEWS } from '../../shared/types';
import { accessibleMailboxIds, requireThread, resolveMailboxScope } from '../auth/access';
import { currentUser, requireScope, requireUser } from '../auth/context';
import { attachments, labels, messages, threadLabels, threads } from '../db/schema';
import { badRequest, parseIntParam } from '../lib/http';
import { rateLimit } from '../lib/rate-limit';
import { applyThreadAction, THREAD_ACTIONS } from '../mail/actions';
import { listThreads, threadAttachmentsSummary } from '../mail/queries';
import { router } from './router';

export const threadRoutes = router();
threadRoutes.use('*', requireUser);

threadRoutes.get('/', requireScope('mail:read'), rateLimit('SEARCH_RATE_LIMITER', 'user'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const viewParam = c.req.query('view') ?? 'inbox';
  const view = (VIEWS as readonly string[]).includes(viewParam) ? (viewParam as (typeof VIEWS)[number]) : 'inbox';
  const mailboxIds = await resolveMailboxScope(db, user, c.req.query('mailbox'));
  const q = c.req.query('q')?.trim();
  const categoryParam = c.req.query('category');
  const category = categoryParam && (CATEGORIES as readonly string[]).includes(categoryParam) ? (categoryParam as (typeof CATEGORIES)[number]) : null;
  const search = q ? parseSearchQuery(q) : null;
  let scoped = mailboxIds;
  if (search?.mailbox) scoped = mailboxIds.filter((id) => id === search.mailbox) || mailboxIds;
  const result = await listThreads(db, {
    mailboxIds: scoped.length ? scoped : mailboxIds,
    userId: user.id,
    view: q ? 'search' : view,
    labelId: c.req.query('label') ?? null,
    category,
    search,
    cursor: c.req.query('cursor') ?? null,
    limit: parseIntParam(c.req.query('limit'), 50, 100),
  });
  const attachmentMap = await threadAttachmentsSummary(
    db,
    result.items.filter((t) => t.hasAttachments).map((t) => t.id),
  );
  return c.json({
    items: result.items.map((t) => ({ ...t, attachments: attachmentMap.get(t.id) ?? [] })),
    nextCursor: result.nextCursor,
  });
});

threadRoutes.get('/:id', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const thread = await requireThread(db, user, c.req.param('id'));
  const rows = await db.select().from(messages).where(eq(messages.threadId, thread.id)).orderBy(asc(messages.receivedAt), asc(messages.createdAt));
  const files = rows.length ? await db.select().from(attachments).where(inArray(attachments.messageId, rows.map((m) => m.id))) : [];
  const labelRows = await db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(threadLabels)
    .innerJoin(labels, eq(labels.id, threadLabels.labelId))
    .where(and(eq(threadLabels.threadId, thread.id), eq(labels.userId, user.id)));
  return c.json({
    thread: { ...thread, labels: labelRows },
    messages: rows.map((m) => ({
      ...m,
      attachments: files
        .filter((f) => f.messageId === m.id)
        .map((f) => ({
          id: f.id,
          filename: f.filename,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          disposition: f.disposition,
          contentId: f.contentId,
          url: `/api/messages/${m.id}/attachments/${f.id}`,
        })),
    })),
  });
});

const actionSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum(THREAD_ACTIONS),
  labelId: z.string().optional().nullable(),
  until: z.string().datetime().optional().nullable(),
  category: z.enum(CATEGORIES).optional().nullable(),
});

threadRoutes.post('/actions', requireScope('mail:write'), zValidator('json', actionSchema), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const body = c.req.valid('json');
  const allowed = await accessibleMailboxIds(db, user);
  const rows = await db.select().from(threads).where(and(inArray(threads.id, body.ids), inArray(threads.mailboxId, allowed)));
  if (rows.length === 0) throw badRequest('no_threads', 'No matching conversations.');
  const updated = await applyThreadAction(c.env, db, user.id, rows, {
    action: body.action,
    labelId: body.labelId ?? null,
    until: body.until ? new Date(body.until) : null,
    category: body.category ?? null,
  });
  return c.json({ updated: updated.map((t) => t.id), removed: body.action === 'delete_forever' ? rows.map((t) => t.id) : [] });
});

threadRoutes.patch('/:id', requireScope('mail:write'), zValidator('json', actionSchema.omit({ ids: true })), async (c) => {
  const user = currentUser(c);
  const thread = await requireThread(c.var.db, user, c.req.param('id'), 'read_only');
  const body = c.req.valid('json');
  const updated = await applyThreadAction(c.env, c.var.db, user.id, [thread], {
    action: body.action,
    labelId: body.labelId ?? null,
    until: body.until ? new Date(body.until) : null,
    category: body.category ?? null,
  });
  return c.json({ thread: updated[0] ?? null });
});
