import { eq } from 'drizzle-orm';
import type { Address, MessageStatus } from '../../../shared/types';
import type { Db } from '../../db/client';
import { attachments, deliveryEvents, domains, mailboxes, messages, type Message } from '../../db/schema';
import type { AppEnv } from '../../env';
import { newId } from '../../lib/crypto';
import { dispatchWebhooks } from '../../lib/webhooks-out';
import { publishToUsers } from '../../realtime/hub';
import { getProvider } from '../providers/registry';
import { ProviderError, type DeliveryEvent, type OutboundAttachment, type OutboundMessage } from '../providers/types';
import { loadAttachment } from '../store';
import { recomputeThread } from '../threads';
import { mailboxUserIds } from './recipients';

export type QueueSendMessage = { type: 'send'; messageId: string; attempt?: number };

export async function queueSend(env: AppEnv, db: Db, message: Message, delaySeconds = 0): Promise<void> {
  await db
    .update(messages)
    .set({ status: 'queued', isDraft: false, statusAt: new Date(), statusDetail: null })
    .where(eq(messages.id, message.id));
  await recomputeThread(db, message.threadId);
  const body: QueueSendMessage = { type: 'send', messageId: message.id };
  await env.OUTBOUND_QUEUE.send(body, delaySeconds > 0 ? { delaySeconds } : undefined);
}

/**
 * Queue consumer body: hands a queued message to its domain's provider and
 * records the outcome. Retryable provider errors are re-thrown so the queue
 * retries with backoff; permanent errors mark the message failed.
 */
export async function deliverMessage(env: AppEnv, db: Db, messageId: string): Promise<void> {
  const message = await db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!message) return;
  if (message.status !== 'queued' && message.status !== 'sending') {
    // Cancelled via undo, already sent, or turned back into a draft.
    return;
  }
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, message.mailboxId)).get();
  const domain = mailbox ? await db.select().from(domains).where(eq(domains.id, mailbox.domainId)).get() : undefined;
  if (!mailbox || !domain) {
    await markFailed(env, db, message, 'Mailbox or domain no longer exists');
    return;
  }

  await db.update(messages).set({ status: 'sending', statusAt: new Date() }).where(eq(messages.id, message.id));

  const provider = await getProvider(env, db, domain.provider);
  const files = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
  const outboundAttachments: OutboundAttachment[] = [];
  for (const file of files) {
    const content = await loadAttachment(env.STORAGE, file.r2Key);
    if (!content) continue;
    outboundAttachments.push({ filename: file.filename, contentType: file.contentType, content, disposition: file.disposition, contentId: file.contentId });
  }

  const headers: Record<string, string> = { ...(message.headers ?? {}) };
  if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo;
  if (message.referencesHeader) headers['References'] = message.referencesHeader;
  headers['X-Mailcove-Message'] = message.id;

  const outbound: OutboundMessage = {
    from: { email: message.fromAddr, name: message.fromName ?? mailbox.displayName ?? null },
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo?.[0] ?? null,
    subject: message.subject,
    text: message.textBody,
    html: message.htmlBody,
    headers,
    attachments: outboundAttachments,
    idempotencyKey: `mailcove-${message.id}`,
  };

  try {
    const result = await provider.send(outbound);
    const now = new Date();
    const messageIdHeader = result.messageIdHeader ?? (result.providerMessageId.includes('@') ? `<${result.providerMessageId.replace(/^<|>$/g, '')}>` : null);
    await db
      .update(messages)
      .set({
        status: result.status,
        statusAt: now,
        statusDetail: null,
        sentAt: now,
        receivedAt: now,
        providerMessageId: result.providerMessageId,
        provider: domain.provider,
        messageId: messageIdHeader ?? message.messageId,
        scheduledAt: null,
      })
      .where(eq(messages.id, message.id));
    await recomputeThread(db, message.threadId);
    const userIds = await mailboxUserIds(db, mailbox.id);
    await publishToUsers(env, userIds, { type: 'message.status', messageId: message.id, threadId: message.threadId, status: result.status });
    await dispatchWebhooks(db, userIds, 'message.sent', summarize(message, result.providerMessageId));
  } catch (error) {
    const providerErr = error instanceof ProviderError ? error : null;
    if (providerErr?.retryable) {
      await db.update(messages).set({ status: 'queued', statusDetail: providerErr.message, statusAt: new Date() }).where(eq(messages.id, message.id));
      throw error;
    }
    await markFailed(env, db, message, error instanceof Error ? error.message : String(error));
  }
}

export async function markFailed(env: AppEnv, db: Db, message: Message, detail: string): Promise<void> {
  await db.update(messages).set({ status: 'failed', statusDetail: detail.slice(0, 1000), statusAt: new Date() }).where(eq(messages.id, message.id));
  await recomputeThread(db, message.threadId);
  const userIds = await mailboxUserIds(db, message.mailboxId);
  await publishToUsers(env, userIds, { type: 'message.status', messageId: message.id, threadId: message.threadId, status: 'failed' });
  await dispatchWebhooks(db, userIds, 'message.failed', { ...summarize(message, message.providerMessageId), error: detail });
}

const DELIVERY_STATUS: Partial<Record<DeliveryEvent['type'], MessageStatus>> = {
  sent: 'sent',
  delivered: 'delivered',
  delayed: 'delayed',
  bounced: 'bounced',
  complained: 'complained',
  failed: 'failed',
};

/** Applies a provider delivery event (bounce, delivered, ...) to the matching outbound message. */
export async function applyDeliveryEvent(env: AppEnv, db: Db, event: DeliveryEvent): Promise<void> {
  const message = event.providerMessageId
    ? await db.select().from(messages).where(eq(messages.providerMessageId, event.providerMessageId)).get()
    : undefined;
  await db.insert(deliveryEvents).values({
    id: newId(),
    messageId: message?.id ?? null,
    provider: event.provider,
    type: event.type,
    recipient: event.recipient ?? null,
    detail: event.detail ?? null,
    occurredAt: event.occurredAt,
  });
  if (!message) return;

  const next = DELIVERY_STATUS[event.type];
  if (!next) return;
  // Never regress a terminal state (delivered → delayed from a late event).
  const rank: Record<string, number> = { queued: 1, sending: 1, sent: 2, delayed: 2, delivered: 3, bounced: 4, complained: 4, failed: 4 };
  if ((rank[message.status] ?? 0) > (rank[next] ?? 0)) return;
  await db
    .update(messages)
    .set({
      status: next,
      statusAt: event.occurredAt,
      statusDetail: typeof event.detail?.reason === 'string' ? (event.detail.reason as string) : null,
    })
    .where(eq(messages.id, message.id));
  const userIds = await mailboxUserIds(db, message.mailboxId);
  await publishToUsers(env, userIds, { type: 'message.status', messageId: message.id, threadId: message.threadId, status: next });
  const webhookEvent = next === 'delivered' ? 'message.delivered' : next === 'bounced' ? 'message.bounced' : next === 'complained' ? 'message.complained' : next === 'failed' ? 'message.failed' : null;
  if (webhookEvent) await dispatchWebhooks(db, userIds, webhookEvent, { ...summarize(message, message.providerMessageId), recipient: event.recipient ?? null, detail: event.detail ?? null });
}

function summarize(message: Message, providerMessageId: string | null): Record<string, unknown> {
  return {
    id: message.id,
    threadId: message.threadId,
    mailboxId: message.mailboxId,
    from: { email: message.fromAddr, name: message.fromName } satisfies Address,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    providerMessageId,
    status: message.status,
  };
}
