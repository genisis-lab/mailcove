import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { displayName, domainOf, normalizeEmail } from '../../../shared/address';
import { forwardSubject, htmlToText, makeSnippet, truncateUtf8 } from '../../../shared/text';
import type { Address, Category, MailProviderKind, ThreadFolder } from '../../../shared/types';
import type { Db } from '../../db/client';
import {
  blockedSenders,
  contacts,
  filters,
  labels,
  messages,
  threadLabels,
  threads,
  unroutedMessages,
  type Domain,
  type Mailbox,
  type Message,
} from '../../db/schema';
import type { AppEnv } from '../../env';
import { newId } from '../../lib/crypto';
import { sendPushToUsers } from '../../lib/push';
import { getSetting } from '../../lib/settings';
import { dispatchWebhooks } from '../../lib/webhooks-out';
import { publishToUsers } from '../../realtime/hub';
import { composeMessage } from '../outbound/compose';
import { queueSend } from '../outbound/deliver';
import { mailboxUserIds } from '../outbound/recipients';
import type { ParsedMail } from '../providers/types';
import { MAX_BODY_BYTES, storeAttachments } from '../store';
import { recomputeThread, resolveThreadId } from '../threads';
import { assessSpam, categorize, parseAuthResults, parseListUnsubscribe } from './classify';
import { maybeAutoReply } from './auto-reply';
import { runFilters } from './filters';
import { routeRecipients, type RouteResult } from './route';

export type IngestContext = {
  provider: MailProviderKind;
  providerMessageId: string;
  envelopeFrom: string;
  envelopeTo: string[];
  rawKey?: string | null;
};

export type IngestResult = {
  stored: Array<{ mailboxId: string; messageId: string; threadId: string; folder: ThreadFolder }>;
  unrouted: string[];
  rejected: string[];
};

/** Stores a parsed inbound message into every mailbox it routes to. */
export async function ingestMail(env: AppEnv, db: Db, mail: ParsedMail, context: IngestContext): Promise<IngestResult> {
  const recipients = context.envelopeTo.length
    ? context.envelopeTo
    : [...mail.to, ...mail.cc, ...mail.bcc].map((a) => a.email);
  const { routes, byMailbox } = await routeRecipients(db, recipients);
  const result: IngestResult = { stored: [], unrouted: [], rejected: [] };

  for (const route of routes) {
    if (route.kind === 'unrouted' || route.kind === 'unknown_domain' || route.kind === 'disabled') {
      await recordUnrouted(db, route, mail, context);
      result.unrouted.push(route.recipient);
    }
  }

  for (const route of byMailbox.values()) {
    const stored = await ingestIntoMailbox(env, db, mail, context, route.mailbox, route.domain, route.recipient);
    if (stored) result.stored.push(stored);
  }
  return result;
}

async function recordUnrouted(db: Db, route: RouteResult, mail: ParsedMail, context: IngestContext): Promise<void> {
  const domain = 'domain' in route ? route.domain : null;
  await db.insert(unroutedMessages).values({
    id: newId(),
    domainId: domain?.id ?? null,
    envelopeFrom: context.envelopeFrom || mail.from.email,
    envelopeTo: route.recipient,
    subject: mail.subject.slice(0, 500),
    rawR2Key: context.rawKey ?? null,
    provider: context.provider,
    providerMessageId: context.providerMessageId,
    reason: route.kind === 'disabled' ? 'mailbox_disabled' : route.kind === 'unknown_domain' ? 'unknown_domain' : 'no_mailbox',
    sizeBytes: mail.sizeBytes,
  });
}

async function ingestIntoMailbox(
  env: AppEnv,
  db: Db,
  mail: ParsedMail,
  context: IngestContext,
  mailbox: Mailbox,
  domain: Domain,
  recipient: string,
): Promise<IngestResult['stored'][number] | null> {
  // Idempotency: the same Message-ID landing twice in one mailbox is a retry.
  if (mail.messageId) {
    const dup = await db
      .select({ id: messages.id, threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.mailboxId, mailbox.id), eq(messages.messageId, mail.messageId), eq(messages.direction, 'inbound')))
      .get();
    if (dup) {
      const thread = await db.select({ folder: threads.folder }).from(threads).where(eq(threads.id, dup.threadId)).get();
      return { mailboxId: mailbox.id, messageId: dup.id, threadId: dup.threadId, folder: thread?.folder ?? 'inbox' };
    }
  }
  const ownerId = mailbox.ownerUserId;
  const now = new Date();
  const receivedAt = mail.date && Math.abs(mail.date.getTime() - now.getTime()) < 7 * 24 * 3600 * 1000 ? mail.date : now;

  const text = mail.text?.trim() ? mail.text : mail.html ? htmlToText(mail.html) : '';
  const bodyText = truncateUtf8(text, MAX_BODY_BYTES);
  const html = mail.html ? truncateUtf8(mail.html, MAX_BODY_BYTES) : null;
  const snippet = makeSnippet(text, 180);

  const auth = parseAuthResults(mail);
  const spam = assessSpam(mail, auth);
  const listUnsubscribe = parseListUnsubscribe(mail);
  const categorization = await getSetting(db, 'inboundCategorization');
  let category: Category = categorization ? categorize(mail) : 'primary';

  let blocked = false;
  let filterActions: ReturnType<typeof runFilters>['actions'] = {};
  if (ownerId) {
    const blocks = await db.select({ pattern: blockedSenders.pattern }).from(blockedSenders).where(eq(blockedSenders.userId, ownerId));
    const senderDomain = domainOf(mail.from.email);
    blocked = blocks.some((b) => b.pattern === mail.from.email || b.pattern === `@${senderDomain}`);

    const userFilters = await db
      .select()
      .from(filters)
      .where(and(eq(filters.userId, ownerId), eq(filters.enabled, true), or(isNull(filters.mailboxId), eq(filters.mailboxId, mailbox.id))));
    filterActions = runFilters({ mail, recipient, bodyText }, userFilters).actions;
    if (filterActions.category) category = filterActions.category;
  }

  const isSpam = blocked || (filterActions.markSpam ?? false) || (spam.isSpam && !filterActions.neverSpam);
  const participants: Address[] = [mail.from, ...mail.to, ...mail.cc];
  const { threadId, created } = await resolveThreadId(db, {
    mailboxId: mailbox.id,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    subject: mail.subject,
    participants,
    date: receivedAt,
  });
  const existingThread = created ? null : await db.select().from(threads).where(eq(threads.id, threadId)).get();

  const messageId = newId();
  await db.insert(messages).values({
    id: messageId,
    threadId,
    mailboxId: mailbox.id,
    direction: 'inbound',
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    referencesHeader: mail.references,
    fromAddr: mail.from.email,
    fromName: mail.from.name ?? null,
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    replyTo: mail.replyTo.length ? mail.replyTo : null,
    subject: mail.subject.slice(0, 998),
    snippet,
    textBody: bodyText,
    htmlBody: html,
    rawR2Key: context.rawKey ?? null,
    sizeBytes: mail.sizeBytes,
    hasAttachments: mail.attachments.some((a) => a.disposition === 'attachment'),
    isRead: filterActions.markRead ?? false,
    isStarred: filterActions.star ?? false,
    isDraft: false,
    status: 'received',
    statusAt: now,
    receivedAt,
    authResults: auth,
    listUnsubscribe,
    listId: mail.headers['list-id'] ?? null,
    headers: pickHeaders(mail.headers),
    category,
    provider: context.provider,
    providerMessageId: context.providerMessageId,
  });

  if (mail.attachments.length) {
    await storeAttachments(db, env.STORAGE, messageId, mail.attachments);
  }

  // Decide where the conversation lives now.
  let folder: ThreadFolder = 'inbox';
  if (isSpam) folder = 'spam';
  else if (filterActions.trash) folder = 'trash';
  else if (filterActions.skipInbox) folder = existingThread && existingThread.folder !== 'trash' ? existingThread.folder : 'archive';
  else if (existingThread?.folder === 'spam' && !filterActions.neverSpam) folder = 'spam';

  if (ownerId && filterActions.labelIds?.length) {
    const owned = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.userId, ownerId), inArray(labels.id, filterActions.labelIds)));
    for (const label of owned) {
      await db.insert(threadLabels).values({ threadId, labelId: label.id }).onConflictDoNothing();
    }
  }

  await db
    .update(threads)
    .set({
      snoozedUntil: null,
      category: existingThread && existingThread.category !== 'primary' ? existingThread.category : category,
      isImportant: filterActions.markImportant ? true : (existingThread?.isImportant ?? false),
    })
    .where(eq(threads.id, threadId));
  await recomputeThread(db, threadId, { folder });

  const stored = (await db.select().from(messages).where(eq(messages.id, messageId)).get())!;

  if (ownerId && !isSpam) await touchContact(db, ownerId, mail.from, receivedAt);

  const userIds = await mailboxUserIds(db, mailbox.id);
  await publishToUsers(env, userIds, {
    type: 'message.new',
    threadId,
    mailboxId: mailbox.id,
    messageId,
    from: mail.from,
    subject: mail.subject,
  });
  if (!isSpam && folder === 'inbox' && !filterActions.markRead) {
    await sendPushToUsers(env, db, userIds, {
      title: displayName(mail.from, mail.from.email),
      body: mail.subject || snippet || '(no subject)',
      tag: `mailcove-${threadId}`,
      url: `/mail/inbox/${threadId}`,
      threadId,
      messageId,
    });
  }
  await dispatchWebhooks(db, userIds, 'message.received', {
    id: messageId,
    threadId,
    mailboxId: mailbox.id,
    mailbox: mailbox.address,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    snippet,
    receivedAt: receivedAt.toISOString(),
    hasAttachments: stored.hasAttachments,
    folder,
    category,
    spam: isSpam,
  });

  if (!isSpam) {
    try {
      await maybeAutoReply(env, db, mailbox, domain, mail, stored);
    } catch (error) {
      console.warn('auto-reply failed', error);
    }
    if (filterActions.forwardTo && !mail.headers['x-mailcove-forwarded']) {
      try {
        await forwardInbound(env, db, mailbox, domain, mail, stored, filterActions.forwardTo);
      } catch (error) {
        console.warn('filter forward failed', error);
      }
    }
  }

  return { mailboxId: mailbox.id, messageId, threadId, folder };
}

async function forwardInbound(env: AppEnv, db: Db, mailbox: Mailbox, domain: Domain, mail: ParsedMail, stored: Message, target: string): Promise<void> {
  const to = normalizeEmail(target);
  if (!to || to === mailbox.address) return;
  const header = `<div style="color:#666;font-size:12px;margin-bottom:12px">Forwarded message from ${escape(displayName(mail.from, mail.from.email))} &lt;${escape(mail.from.email)}&gt;</div>`;
  const html = header + (stored.htmlBody ?? `<pre style="white-space:pre-wrap">${escape(stored.textBody ?? '')}</pre>`);
  const forward = await composeMessage(db, {
    mailbox,
    domain,
    authorUserId: null,
    from: { email: mailbox.address, name: mailbox.displayName ?? null },
    to: [{ email: to, name: null }],
    subject: forwardSubject(mail.subject || '(no subject)'),
    html,
    text: `Forwarded message from ${mail.from.email}\n\n${stored.textBody ?? ''}`,
    rawAttachments: mail.attachments,
    forwardOfMessageId: stored.id,
    sendMode: 'forward',
    headers: { 'X-Mailcove-Forwarded': '1', 'X-Original-From': mail.from.email, ...(mail.messageId ? { 'X-Original-Message-ID': mail.messageId } : {}) },
    bucket: env.STORAGE,
  });
  await queueSend(env, db, forward, 0);
}

async function touchContact(db: Db, userId: string, address: Address, seenAt: Date): Promise<void> {
  const email = normalizeEmail(address.email);
  if (!email) return;
  await db
    .insert(contacts)
    .values({ id: newId(), userId, email, name: address.name ?? null, source: 'inbound', frequency: 1, lastSeenAt: seenAt })
    .onConflictDoUpdate({
      target: [contacts.userId, contacts.email],
      set: {
        frequency: sql`${contacts.frequency} + 1`,
        lastSeenAt: seenAt,
        name: sql`coalesce(${contacts.name}, ${address.name ?? null})`,
        updatedAt: new Date(),
      },
    });
}

const STORED_HEADERS = ['list-id', 'list-unsubscribe', 'list-unsubscribe-post', 'precedence', 'auto-submitted', 'authentication-results', 'x-mailer', 'user-agent', 'x-priority', 'importance', 'return-path', 'delivered-to'];

function pickHeaders(headers: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const key of STORED_HEADERS) if (headers[key]) out[key] = headers[key]!.slice(0, 2000);
  return Object.keys(out).length ? out : null;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
