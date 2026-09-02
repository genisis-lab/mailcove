import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { uniqueAddresses } from '../../shared/address';
import { makeSnippet, normalizeSubject } from '../../shared/text';
import type { Address, ThreadFolder } from '../../shared/types';
import type { Db } from '../db/client';
import { messages, threads, type Thread } from '../db/schema';
import { newId } from '../lib/crypto';

const SUBJECT_FALLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type ThreadCandidate = {
  mailboxId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  subject: string;
  participants: Address[];
  date: Date;
  /** Explicit parent (reply composed in-app). */
  replyToMessageId?: string | null;
};

export function extractMessageIds(...values: Array<string | null | undefined>): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/<([^<>\s]+)>/g)) ids.add(`<${match[1]}>`);
    if (!value.includes('<') && value.trim()) ids.add(`<${value.trim()}>`);
  }
  return [...ids];
}

export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`;
}

/**
 * Finds the conversation a message belongs to. Order: explicit in-app parent →
 * In-Reply-To/References against stored Message-IDs → same normalized subject
 * with an overlapping participant within 30 days → new thread.
 */
export async function resolveThreadId(db: Db, candidate: ThreadCandidate): Promise<{ threadId: string; created: boolean }> {
  if (candidate.replyToMessageId) {
    const parent = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.id, candidate.replyToMessageId), eq(messages.mailboxId, candidate.mailboxId)))
      .get();
    if (parent) return { threadId: parent.threadId, created: false };
  }

  const referenced = extractMessageIds(candidate.inReplyTo, candidate.references).filter((id) => id !== normalizeMessageId(candidate.messageId));
  if (referenced.length) {
    const match = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.mailboxId, candidate.mailboxId), inArray(messages.messageId, referenced.slice(0, 50))))
      .orderBy(desc(messages.receivedAt))
      .get();
    if (match) return { threadId: match.threadId, created: false };
  }

  const subjectNorm = normalizeSubject(candidate.subject);
  const looksLikeReply = /^\s*(re|fw|fwd|aw|wg|sv)\s*(\[\d+\])?\s*:/i.test(candidate.subject);
  if (subjectNorm && (looksLikeReply || referenced.length > 0)) {
    const since = new Date(candidate.date.getTime() - SUBJECT_FALLBACK_WINDOW_MS);
    const participantEmails = new Set(candidate.participants.map((p) => p.email));
    const candidates = await db
      .select({ id: threads.id, participants: threads.participants })
      .from(threads)
      .where(and(eq(threads.mailboxId, candidate.mailboxId), eq(threads.subjectNorm, subjectNorm), gte(threads.lastMessageAt, since)))
      .orderBy(desc(threads.lastMessageAt))
      .limit(10);
    for (const t of candidates) {
      if (t.participants.some((p) => participantEmails.has(p.email))) return { threadId: t.id, created: false };
    }
  }

  const id = newId();
  await db.insert(threads).values({
    id,
    mailboxId: candidate.mailboxId,
    subject: candidate.subject.slice(0, 998),
    subjectNorm,
    snippet: '',
    participants: uniqueAddresses(candidate.participants),
    folder: 'inbox',
    lastMessageAt: candidate.date,
    firstMessageAt: candidate.date,
  });
  return { threadId: id, created: true };
}

const SENT_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'failed'] as const;

/** Rebuilds denormalized counters and preview fields from the thread's messages. */
export async function recomputeThread(db: Db, threadId: string, options: { folder?: ThreadFolder } = {}): Promise<Thread | null> {
  const stats = await db
    .select({
      total: sql<number>`count(*)`,
      live: sql<number>`sum(case when ${messages.trashedAt} is null then 1 else 0 end)`,
      unread: sql<number>`sum(case when ${messages.isRead} = 0 and ${messages.isDraft} = 0 and ${messages.trashedAt} is null then 1 else 0 end)`,
      starred: sql<number>`sum(case when ${messages.isStarred} = 1 and ${messages.trashedAt} is null then 1 else 0 end)`,
      sent: sql<number>`sum(case when ${messages.direction} = 'outbound' and ${messages.status} in (${sql.join(
        SENT_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )}) and ${messages.trashedAt} is null then 1 else 0 end)`,
      drafts: sql<number>`sum(case when ${messages.isDraft} = 1 and ${messages.trashedAt} is null then 1 else 0 end)`,
      scheduled: sql<number>`sum(case when ${messages.status} = 'scheduled' and ${messages.trashedAt} is null then 1 else 0 end)`,
      attachments: sql<number>`max(case when ${messages.hasAttachments} = 1 and ${messages.trashedAt} is null then 1 else 0 end)`,
      last: sql<number>`max(case when ${messages.isDraft} = 0 and ${messages.trashedAt} is null then ${messages.receivedAt} else null end)`,
      lastAny: sql<number>`max(${messages.receivedAt})`,
      first: sql<number>`min(${messages.receivedAt})`,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .get();

  if (!stats || Number(stats.total) === 0) {
    await db.delete(threads).where(eq(threads.id, threadId));
    return null;
  }

  const latest = await db
    .select({ snippet: messages.snippet, subject: messages.subject })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isNull(messages.trashedAt)))
    .orderBy(desc(messages.isDraft), desc(messages.receivedAt))
    .limit(1)
    .get();

  const participantRows = await db
    .select({ fromAddr: messages.fromAddr, fromName: messages.fromName, to: messages.to, cc: messages.cc })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isNull(messages.trashedAt)))
    .orderBy(desc(messages.receivedAt))
    .limit(30);
  const participants: Address[] = [];
  for (const row of participantRows) {
    if (row.fromAddr) participants.push({ email: row.fromAddr, name: row.fromName ?? null });
    participants.push(...row.to, ...row.cc);
  }

  const lastMs = Number(stats.last ?? stats.lastAny ?? Date.now());
  const patch: Partial<typeof threads.$inferInsert> = {
    messageCount: Number(stats.live ?? 0),
    unreadCount: Number(stats.unread ?? 0),
    starredCount: Number(stats.starred ?? 0),
    sentCount: Number(stats.sent ?? 0),
    draftCount: Number(stats.drafts ?? 0),
    scheduledCount: Number(stats.scheduled ?? 0),
    hasAttachments: Number(stats.attachments ?? 0) > 0,
    lastMessageAt: new Date(lastMs),
    firstMessageAt: new Date(Number(stats.first ?? lastMs)),
    snippet: latest?.snippet ?? '',
    participants: uniqueAddresses(participants).slice(0, 20),
    updatedAt: new Date(),
  };
  if (latest?.subject) {
    patch.subject = latest.subject.slice(0, 998);
    patch.subjectNorm = normalizeSubject(latest.subject);
  }
  if (options.folder) patch.folder = options.folder;
  else if (Number(stats.live ?? 0) === 0) patch.folder = 'trash';

  await db.update(threads).set(patch).where(eq(threads.id, threadId));
  return (await db.select().from(threads).where(eq(threads.id, threadId)).get()) ?? null;
}

export function snippetFor(text: string | null | undefined, html: string | null | undefined, htmlToText: (h: string) => string): string {
  const source = text?.trim() ? text : html ? htmlToText(html) : '';
  return makeSnippet(source, 180);
}
