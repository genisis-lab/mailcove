import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Category } from '../../shared/types';
import type { Db } from '../db/client';
import { labels, messages, threadLabels, threads, type Thread } from '../db/schema';
import type { AppEnv } from '../env';
import { badRequest } from '../lib/http';
import { publishToUser } from '../realtime/hub';
import { deleteMessageObjects } from './store';
import { recomputeThread } from './threads';

export const THREAD_ACTIONS = [
  'archive',
  'inbox',
  'trash',
  'spam',
  'not_spam',
  'read',
  'unread',
  'star',
  'unstar',
  'snooze',
  'unsnooze',
  'delete_forever',
  'add_label',
  'remove_label',
  'important',
  'not_important',
  'category',
] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

export type ThreadActionInput = {
  action: ThreadAction;
  labelId?: string | null;
  until?: Date | null;
  category?: Category | null;
};

/** Applies one action to a set of threads the caller already authorized. */
export async function applyThreadAction(env: AppEnv, db: Db, userId: string, threadRows: Thread[], input: ThreadActionInput): Promise<Thread[]> {
  if (threadRows.length === 0) return [];
  const ids = threadRows.map((t) => t.id);
  const now = new Date();

  switch (input.action) {
    case 'archive':
      await db.update(threads).set({ folder: 'archive', snoozedUntil: null, updatedAt: now }).where(inArray(threads.id, ids));
      break;
    case 'inbox':
      await db.update(threads).set({ folder: 'inbox', snoozedUntil: null, updatedAt: now }).where(inArray(threads.id, ids));
      await db.update(messages).set({ trashedAt: null }).where(inArray(messages.threadId, ids));
      break;
    case 'trash':
      await db.update(threads).set({ folder: 'trash', snoozedUntil: null, updatedAt: now }).where(inArray(threads.id, ids));
      break;
    case 'spam':
      await db.update(threads).set({ folder: 'spam', snoozedUntil: null, updatedAt: now }).where(inArray(threads.id, ids));
      break;
    case 'not_spam':
      await db.update(threads).set({ folder: 'inbox', updatedAt: now }).where(and(inArray(threads.id, ids), eq(threads.folder, 'spam')));
      break;
    case 'read':
      await db.update(messages).set({ isRead: true }).where(and(inArray(messages.threadId, ids), isNull(messages.trashedAt)));
      break;
    case 'unread':
      await db.update(messages).set({ isRead: false }).where(and(inArray(messages.threadId, ids), isNull(messages.trashedAt), eq(messages.isDraft, false)));
      break;
    case 'star': {
      // Star the latest message of each thread (mirrors how webmail stars a conversation).
      for (const id of ids) {
        const latest = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.threadId, id), isNull(messages.trashedAt)))
          .orderBy(messages.receivedAt)
          .all();
        const target = latest[latest.length - 1];
        if (target) await db.update(messages).set({ isStarred: true }).where(eq(messages.id, target.id));
      }
      break;
    }
    case 'unstar':
      await db.update(messages).set({ isStarred: false }).where(inArray(messages.threadId, ids));
      break;
    case 'snooze': {
      if (!input.until || input.until.getTime() <= Date.now()) throw badRequest('invalid_snooze', 'Snooze time must be in the future.');
      await db.update(threads).set({ snoozedUntil: input.until, folder: 'inbox', updatedAt: now }).where(inArray(threads.id, ids));
      break;
    }
    case 'unsnooze':
      await db.update(threads).set({ snoozedUntil: null, folder: 'inbox', updatedAt: now }).where(inArray(threads.id, ids));
      break;
    case 'delete_forever': {
      const rows = await db.select({ id: messages.id, rawR2Key: messages.rawR2Key }).from(messages).where(inArray(messages.threadId, ids));
      for (const m of rows) await deleteMessageObjects(db, env.STORAGE, m);
      await db.delete(threads).where(inArray(threads.id, ids));
      for (const t of threadRows) await publishToUser(env, userId, { type: 'thread.updated', threadId: t.id, mailboxId: t.mailboxId });
      return [];
    }
    case 'add_label': {
      const label = input.labelId ? await db.select().from(labels).where(and(eq(labels.id, input.labelId), eq(labels.userId, userId))).get() : null;
      if (!label) throw badRequest('label_not_found', 'Label not found.');
      for (const id of ids) await db.insert(threadLabels).values({ threadId: id, labelId: label.id }).onConflictDoNothing();
      break;
    }
    case 'remove_label': {
      if (!input.labelId) throw badRequest('label_required');
      await db.delete(threadLabels).where(and(inArray(threadLabels.threadId, ids), eq(threadLabels.labelId, input.labelId)));
      break;
    }
    case 'important':
      await db.update(threads).set({ isImportant: true, updatedAt: now }).where(inArray(threads.id, ids));
      break;
    case 'not_important':
      await db.update(threads).set({ isImportant: false, updatedAt: now }).where(inArray(threads.id, ids));
      break;
    case 'category':
      if (!input.category) throw badRequest('category_required');
      await db.update(threads).set({ category: input.category, updatedAt: now }).where(inArray(threads.id, ids));
      break;
    default: {
      const never: never = input.action;
      throw badRequest('unknown_action', `Unknown action ${String(never)}`);
    }
  }

  const updated: Thread[] = [];
  for (const t of threadRows) {
    const fresh = await recomputeThread(db, t.id);
    if (fresh) updated.push(fresh);
    await publishToUser(env, userId, { type: 'thread.updated', threadId: t.id, mailboxId: t.mailboxId });
  }
  return updated;
}
