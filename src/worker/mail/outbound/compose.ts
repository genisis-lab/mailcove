import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uniqueAddresses } from '../../../shared/address';
import { htmlToText, makeSnippet, textToHtml, truncateUtf8 } from '../../../shared/text';
import type { Address } from '../../../shared/types';
import type { Db } from '../../db/client';
import { attachments, messages, type Domain, type Mailbox, type Message } from '../../db/schema';
import { newId } from '../../lib/crypto';
import { badRequest } from '../../lib/http';
import type { ParsedAttachment } from '../providers/types';
import { MAX_BODY_BYTES, storeAttachments } from '../store';
import { recomputeThread, resolveThreadId } from '../threads';

export type ComposeInput = {
  mailbox: Mailbox;
  domain: Domain;
  authorUserId: string | null;
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  replyTo?: Address | null;
  subject: string;
  html?: string | null;
  text?: string | null;
  /** Staged upload ids (attachments rows with messageId = null) owned by the author. */
  uploadIds?: string[];
  /** Raw attachments (used by forwards and auto-replies). */
  rawAttachments?: ParsedAttachment[];
  replyToMessageId?: string | null;
  forwardOfMessageId?: string | null;
  sendMode?: 'reply' | 'reply_all' | 'forward' | 'new';
  headers?: Record<string, string>;
  scheduledAt?: Date | null;
  /** Store as draft instead of queuing. */
  draft?: boolean;
  /** Reuse an existing draft row instead of creating a new message. */
  existingDraftId?: string | null;
  bucket: R2Bucket;
};

/** Persists an outbound message (draft, scheduled or ready to queue) and its attachments. */
export async function composeMessage(db: Db, input: ComposeInput): Promise<Message> {
  const to = uniqueAddresses(input.to);
  const cc = uniqueAddresses(input.cc ?? []);
  const bcc = uniqueAddresses(input.bcc ?? []);
  if (!input.draft && to.length + cc.length + bcc.length === 0) throw badRequest('no_recipients', 'Add at least one recipient.');

  const html = input.html?.trim() ? input.html : input.text ? textToHtml(input.text) : null;
  const text = input.text?.trim() ? input.text : html ? htmlToText(html) : '';
  const now = new Date();
  const messageId = input.existingDraftId ?? newId();

  // Threading headers derived from the message being replied to.
  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (input.replyToMessageId) {
    const parent = await db.select().from(messages).where(eq(messages.id, input.replyToMessageId)).get();
    if (parent?.messageId) {
      inReplyTo = parent.messageId;
      references = [parent.referencesHeader, parent.messageId].filter(Boolean).join(' ').trim() || parent.messageId;
    }
  }

  const participants: Address[] = [input.from, ...to, ...cc];
  const { threadId } = input.existingDraftId
    ? { threadId: (await db.select({ threadId: messages.threadId }).from(messages).where(eq(messages.id, input.existingDraftId)).get())!.threadId }
    : await resolveThreadId(db, {
        mailboxId: input.mailbox.id,
        messageId: null,
        inReplyTo,
        references,
        subject: input.subject,
        participants,
        date: now,
        replyToMessageId: input.replyToMessageId ?? input.forwardOfMessageId ?? null,
      });

  const status = input.draft ? 'draft' : input.scheduledAt && input.scheduledAt.getTime() > Date.now() + 60_000 ? 'scheduled' : 'queued';
  const values: typeof messages.$inferInsert = {
    id: messageId,
    threadId,
    mailboxId: input.mailbox.id,
    direction: 'outbound',
    messageId: null,
    inReplyTo,
    referencesHeader: references,
    fromAddr: input.from.email,
    fromName: input.from.name ?? input.mailbox.displayName ?? null,
    to,
    cc,
    bcc,
    replyTo: input.replyTo ? [input.replyTo] : null,
    subject: input.subject.slice(0, 998),
    snippet: makeSnippet(text, 180),
    textBody: truncateUtf8(text, MAX_BODY_BYTES),
    htmlBody: html ? truncateUtf8(html, MAX_BODY_BYTES) : null,
    sizeBytes: new TextEncoder().encode(text).length + (html ? new TextEncoder().encode(html).length : 0),
    hasAttachments: false,
    isRead: true,
    isStarred: false,
    isDraft: input.draft ?? false,
    status,
    statusAt: now,
    scheduledAt: input.scheduledAt ?? null,
    receivedAt: now,
    headers: input.headers && Object.keys(input.headers).length ? input.headers : null,
    provider: input.domain.provider,
    replyToMessageId: input.replyToMessageId ?? null,
    forwardOfMessageId: input.forwardOfMessageId ?? null,
    sendMode: input.sendMode ?? 'new',
    updatedAt: now,
  };

  if (input.existingDraftId) {
    const { id: _id, threadId: _threadId, ...patch } = values;
    await db.update(messages).set(patch).where(eq(messages.id, input.existingDraftId));
  } else {
    await db.insert(messages).values(values);
  }

  let attachmentCount = 0;
  if (input.uploadIds?.length && input.authorUserId) {
    // Attach staged uploads: they were stored under uploads/<user>/..., keep the
    // object where it is and just claim the row for this message.
    const rows = await db
      .select()
      .from(attachments)
      .where(and(inArray(attachments.id, input.uploadIds), eq(attachments.uploadedByUserId, input.authorUserId), isNull(attachments.messageId)));
    for (const row of rows) {
      await db.update(attachments).set({ messageId }).where(eq(attachments.id, row.id));
    }
    attachmentCount += rows.length;
  }
  if (input.rawAttachments?.length) {
    const stored = await storeAttachments(db, input.bucket, messageId, input.rawAttachments);
    attachmentCount += stored.length;
  }
  const existingAttachments = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.messageId, messageId));
  attachmentCount = existingAttachments.length;
  const totalAttachmentBytes = await attachmentBytes(db, messageId);
  await db
    .update(messages)
    .set({ hasAttachments: attachmentCount > 0, sizeBytes: values.sizeBytes! + totalAttachmentBytes })
    .where(eq(messages.id, messageId));

  await recomputeThread(db, threadId);
  return (await db.select().from(messages).where(eq(messages.id, messageId)).get())!;
}

export async function attachmentBytes(db: Db, messageId: string): Promise<number> {
  const rows = await db.select({ size: attachments.sizeBytes }).from(attachments).where(eq(attachments.messageId, messageId));
  return rows.reduce((n, r) => n + r.size, 0);
}
