import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { buildFtsMatch, type ParsedSearch } from '../../shared/search-query';
import type { Category, MailView } from '../../shared/types';
import type { Db } from '../db/client';
import { attachments, labels, mailboxes, messages, threadLabels, threads, type Label, type Thread } from '../db/schema';

export type ThreadListItem = Thread & {
  labels: Array<Pick<Label, 'id' | 'name' | 'color'>>;
  mailboxAddress: string;
  lastFrom: { email: string; name: string | null } | null;
  lastDirection: 'inbound' | 'outbound' | null;
};

export type ThreadListOptions = {
  mailboxIds: string[];
  userId: string;
  view: MailView;
  labelId?: string | null;
  category?: Category | null;
  search?: ParsedSearch | null;
  cursor?: string | null;
  limit: number;
};

export type ThreadListResult = { items: ThreadListItem[]; nextCursor: string | null };

export function encodeCursor(thread: Pick<Thread, 'lastMessageAt' | 'id'>): string {
  return `${thread.lastMessageAt.getTime()}:${thread.id}`;
}

export function decodeCursor(cursor: string | null | undefined): { time: number; id: string } | null {
  if (!cursor) return null;
  const idx = cursor.indexOf(':');
  if (idx === -1) return null;
  const time = Number.parseInt(cursor.slice(0, idx), 10);
  const id = cursor.slice(idx + 1);
  if (!Number.isFinite(time) || !id) return null;
  return { time, id };
}

function viewConditions(view: MailView): SQL[] {
  switch (view) {
    case 'inbox':
      return [eq(threads.folder, 'inbox'), sql`${threads.snoozedUntil} is null`, sql`${threads.messageCount} > ${threads.draftCount}`];
    case 'starred':
      return [sql`${threads.starredCount} > 0`, sql`${threads.folder} not in ('spam', 'trash')`];
    case 'snoozed':
      return [sql`${threads.snoozedUntil} is not null`, sql`${threads.folder} not in ('spam', 'trash')`];
    case 'sent':
      return [sql`${threads.sentCount} > 0`, sql`${threads.folder} not in ('spam', 'trash')`];
    case 'drafts':
      return [sql`${threads.draftCount} > 0`, sql`${threads.folder} not in ('spam', 'trash')`];
    case 'scheduled':
      return [sql`${threads.scheduledCount} > 0`, sql`${threads.folder} not in ('spam', 'trash')`];
    case 'all':
      return [sql`${threads.folder} in ('inbox', 'archive')`, sql`${threads.messageCount} > 0`];
    case 'spam':
      return [eq(threads.folder, 'spam')];
    case 'trash':
      return [eq(threads.folder, 'trash')];
    case 'label':
      return [sql`${threads.folder} not in ('spam', 'trash')`];
    case 'search':
      return [];
    default:
      return [eq(threads.folder, 'inbox')];
  }
}

function searchConditions(q: ParsedSearch, mailboxIds: string[], userId: string): SQL[] {
  const conds: SQL[] = [];
  const match = buildFtsMatch(q);
  if (match) {
    conds.push(
      sql`${threads.id} in (select m.thread_id from messages m join messages_fts f on f.rowid = m.rowid where messages_fts match ${match} and m.mailbox_id in ${mailboxIds})`,
    );
  }
  for (const name of q.filename) {
    conds.push(
      sql`${threads.id} in (select m.thread_id from messages m join attachments a on a.message_id = m.id where a.filename like ${'%' + name + '%'} and m.mailbox_id in ${mailboxIds})`,
    );
  }
  for (const labelName of q.labels) {
    conds.push(
      sql`${threads.id} in (select tl.thread_id from thread_labels tl join labels l on l.id = tl.label_id where l.user_id = ${userId} and lower(l.name) = ${labelName})`,
    );
  }
  if (q.hasAttachment) conds.push(eq(threads.hasAttachments, true));
  if (q.isUnread === true) conds.push(sql`${threads.unreadCount} > 0`);
  if (q.isUnread === false) conds.push(sql`${threads.unreadCount} = 0`);
  if (q.isStarred) conds.push(sql`${threads.starredCount} > 0`);
  if (q.isSnoozed) conds.push(sql`${threads.snoozedUntil} is not null`);
  if (q.isImportant) conds.push(eq(threads.isImportant, true));
  if (q.category) conds.push(eq(threads.category, q.category));
  if (q.before) conds.push(sql`${threads.lastMessageAt} < ${q.before.getTime()}`);
  if (q.after) conds.push(sql`${threads.lastMessageAt} > ${q.after.getTime()}`);
  if (q.larger) conds.push(sql`${threads.id} in (select thread_id from messages where size_bytes > ${q.larger} and mailbox_id in ${mailboxIds})`);
  if (q.smaller) conds.push(sql`${threads.id} in (select thread_id from messages where size_bytes < ${q.smaller} and mailbox_id in ${mailboxIds})`);
  switch (q.in) {
    case 'inbox':
    case 'archive':
    case 'spam':
    case 'trash':
      conds.push(eq(threads.folder, q.in));
      break;
    case 'sent':
      conds.push(sql`${threads.sentCount} > 0`);
      break;
    case 'drafts':
      conds.push(sql`${threads.draftCount} > 0`);
      break;
    case 'anywhere':
    case 'all':
      break;
    default:
      conds.push(sql`${threads.folder} not in ('spam', 'trash')`);
  }
  return conds;
}

export async function listThreads(db: Db, options: ThreadListOptions): Promise<ThreadListResult> {
  if (options.mailboxIds.length === 0) return { items: [], nextCursor: null };
  const conds: SQL[] = [inArray(threads.mailboxId, options.mailboxIds), ...viewConditions(options.view)];
  if (options.view === 'label' && options.labelId) {
    conds.push(sql`${threads.id} in (select thread_id from thread_labels where label_id = ${options.labelId})`);
  }
  if (options.category && options.view === 'inbox') conds.push(eq(threads.category, options.category));
  if (options.search) conds.push(...searchConditions(options.search, options.mailboxIds, options.userId));
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    conds.push(sql`(${threads.lastMessageAt} < ${cursor.time} or (${threads.lastMessageAt} = ${cursor.time} and ${threads.id} < ${cursor.id}))`);
  }

  const rows = await db
    .select({ thread: threads, mailboxAddress: mailboxes.address })
    .from(threads)
    .innerJoin(mailboxes, eq(mailboxes.id, threads.mailboxId))
    .where(and(...conds))
    .orderBy(desc(threads.lastMessageAt), desc(threads.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  const items = await decorateThreads(db, page.map((r) => ({ ...r.thread, mailboxAddress: r.mailboxAddress })));
  return { items, nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!.thread) : null };
}

export async function decorateThreads(db: Db, rows: Array<Thread & { mailboxAddress: string }>): Promise<ThreadListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const labelRows = await db
    .select({ threadId: threadLabels.threadId, id: labels.id, name: labels.name, color: labels.color })
    .from(threadLabels)
    .innerJoin(labels, eq(labels.id, threadLabels.labelId))
    .where(inArray(threadLabels.threadId, ids));
  const labelMap = new Map<string, ThreadListItem['labels']>();
  for (const l of labelRows) {
    const list = labelMap.get(l.threadId) ?? [];
    list.push({ id: l.id, name: l.name, color: l.color });
    labelMap.set(l.threadId, list);
  }
  const latest = await db
    .select({ threadId: messages.threadId, fromAddr: messages.fromAddr, fromName: messages.fromName, direction: messages.direction, receivedAt: messages.receivedAt })
    .from(messages)
    .where(and(inArray(messages.threadId, ids), sql`${messages.trashedAt} is null`, eq(messages.isDraft, false)))
    .orderBy(desc(messages.receivedAt));
  const latestMap = new Map<string, (typeof latest)[number]>();
  for (const m of latest) if (!latestMap.has(m.threadId)) latestMap.set(m.threadId, m);

  return rows.map((t) => {
    const last = latestMap.get(t.id);
    return {
      ...t,
      labels: labelMap.get(t.id) ?? [],
      lastFrom: last ? { email: last.fromAddr, name: last.fromName } : null,
      lastDirection: last?.direction ?? null,
    };
  });
}

export type ViewCounts = {
  inbox: number;
  inboxUnread: number;
  starred: number;
  snoozed: number;
  drafts: number;
  scheduled: number;
  spam: number;
  spamUnread: number;
  trash: number;
  labels: Record<string, { total: number; unread: number }>;
  categories: Record<Category, number>;
};

export async function viewCounts(db: Db, mailboxIds: string[], userId: string): Promise<ViewCounts> {
  const empty: ViewCounts = {
    inbox: 0,
    inboxUnread: 0,
    starred: 0,
    snoozed: 0,
    drafts: 0,
    scheduled: 0,
    spam: 0,
    spamUnread: 0,
    trash: 0,
    labels: {},
    categories: { primary: 0, social: 0, promotions: 0, updates: 0, forums: 0 },
  };
  if (mailboxIds.length === 0) return empty;
  const row = await db
    .select({
      inbox: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.messageCount} > ${threads.draftCount} then 1 else 0 end)`,
      inboxUnread: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.unreadCount} > 0 then 1 else 0 end)`,
      starred: sql<number>`sum(case when ${threads.starredCount} > 0 and ${threads.folder} not in ('spam','trash') then 1 else 0 end)`,
      snoozed: sql<number>`sum(case when ${threads.snoozedUntil} is not null and ${threads.folder} not in ('spam','trash') then 1 else 0 end)`,
      drafts: sql<number>`sum(case when ${threads.draftCount} > 0 and ${threads.folder} not in ('spam','trash') then ${threads.draftCount} else 0 end)`,
      scheduled: sql<number>`sum(case when ${threads.scheduledCount} > 0 then ${threads.scheduledCount} else 0 end)`,
      spam: sql<number>`sum(case when ${threads.folder} = 'spam' then 1 else 0 end)`,
      spamUnread: sql<number>`sum(case when ${threads.folder} = 'spam' and ${threads.unreadCount} > 0 then 1 else 0 end)`,
      trash: sql<number>`sum(case when ${threads.folder} = 'trash' then 1 else 0 end)`,
      primary: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.category} = 'primary' and ${threads.unreadCount} > 0 then 1 else 0 end)`,
      social: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.category} = 'social' and ${threads.unreadCount} > 0 then 1 else 0 end)`,
      promotions: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.category} = 'promotions' and ${threads.unreadCount} > 0 then 1 else 0 end)`,
      updates: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.category} = 'updates' and ${threads.unreadCount} > 0 then 1 else 0 end)`,
      forums: sql<number>`sum(case when ${threads.folder} = 'inbox' and ${threads.snoozedUntil} is null and ${threads.category} = 'forums' and ${threads.unreadCount} > 0 then 1 else 0 end)`,
    })
    .from(threads)
    .where(inArray(threads.mailboxId, mailboxIds))
    .get();

  const labelRows = await db
    .select({
      labelId: threadLabels.labelId,
      total: sql<number>`count(*)`,
      unread: sql<number>`sum(case when ${threads.unreadCount} > 0 then 1 else 0 end)`,
    })
    .from(threadLabels)
    .innerJoin(threads, eq(threads.id, threadLabels.threadId))
    .innerJoin(labels, eq(labels.id, threadLabels.labelId))
    .where(and(eq(labels.userId, userId), inArray(threads.mailboxId, mailboxIds), sql`${threads.folder} not in ('spam','trash')`))
    .groupBy(threadLabels.labelId);

  const counts: ViewCounts = {
    ...empty,
    inbox: Number(row?.inbox ?? 0),
    inboxUnread: Number(row?.inboxUnread ?? 0),
    starred: Number(row?.starred ?? 0),
    snoozed: Number(row?.snoozed ?? 0),
    drafts: Number(row?.drafts ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
    spam: Number(row?.spam ?? 0),
    spamUnread: Number(row?.spamUnread ?? 0),
    trash: Number(row?.trash ?? 0),
    categories: {
      primary: Number(row?.primary ?? 0),
      social: Number(row?.social ?? 0),
      promotions: Number(row?.promotions ?? 0),
      updates: Number(row?.updates ?? 0),
      forums: Number(row?.forums ?? 0),
    },
  };
  for (const l of labelRows) counts.labels[l.labelId] = { total: Number(l.total), unread: Number(l.unread ?? 0) };
  return counts;
}

export async function threadAttachmentsSummary(db: Db, threadIds: string[]): Promise<Map<string, Array<{ id: string; filename: string; contentType: string; sizeBytes: number }>>> {
  const map = new Map<string, Array<{ id: string; filename: string; contentType: string; sizeBytes: number }>>();
  if (threadIds.length === 0) return map;
  const rows = await db
    .select({ threadId: messages.threadId, id: attachments.id, filename: attachments.filename, contentType: attachments.contentType, sizeBytes: attachments.sizeBytes })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(inArray(messages.threadId, threadIds), eq(attachments.disposition, 'attachment')));
  for (const r of rows) {
    const list = map.get(r.threadId) ?? [];
    if (list.length < 4) list.push({ id: r.id, filename: r.filename, contentType: r.contentType, sizeBytes: r.sizeBytes });
    map.set(r.threadId, list);
  }
  return map;
}
