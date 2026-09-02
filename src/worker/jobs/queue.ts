import { eq } from 'drizzle-orm';
import type { MailProviderKind } from '../../shared/types';
import { createDb, type Db } from '../db/client';
import { deadLetters, messages } from '../db/schema';
import type { AppEnv } from '../env';
import { newId } from '../lib/crypto';
import { ingestMail } from '../mail/inbound/ingest';
import { deliverMessage, markFailed, type QueueSendMessage } from '../mail/outbound/deliver';
import { parseRawMail } from '../mail/parse';
import { getProvider } from '../mail/providers/registry';
import type { ParsedMail } from '../mail/providers/types';
import { recomputeThread } from '../mail/threads';

export type IngestJob = {
  type: 'ingest';
  provider: MailProviderKind;
  eventId: string;
  providerMessageId: string;
  envelopeFrom: string;
  envelopeTo: string[];
  rawKey?: string | null;
  fetchRef?: string | null;
};

export type QueueJob = IngestJob | QueueSendMessage;

export async function processIngestJob(env: AppEnv, db: Db, job: IngestJob): Promise<void> {
  let parsed: ParsedMail | null = null;
  let rawKey = job.rawKey ?? null;

  if (rawKey) {
    const object = await env.STORAGE.get(rawKey);
    if (!object) throw new Error(`Raw message ${rawKey} missing from R2`);
    parsed = await parseRawMail(await object.arrayBuffer());
  } else if (job.fetchRef) {
    const provider = await getProvider(env, db, job.provider);
    if (!provider.fetchInbound) throw new Error(`${job.provider} cannot fetch inbound content`);
    const fetched = await provider.fetchInbound(job.fetchRef);
    if (fetched.raw) {
      rawKey = `raw/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}/${newId()}.eml`;
      await env.STORAGE.put(rawKey, fetched.raw as Uint8Array<ArrayBuffer>, { httpMetadata: { contentType: 'message/rfc822' } });
      parsed = await parseRawMail(fetched.raw);
    } else if (fetched.parsed) {
      parsed = fetched.parsed;
    }
  }
  if (!parsed) throw new Error('Ingest job carried no content');

  await ingestMail(env, db, parsed, {
    provider: job.provider,
    providerMessageId: job.providerMessageId,
    envelopeFrom: job.envelopeFrom,
    envelopeTo: job.envelopeTo,
    rawKey,
  });
}

/** Shared consumer for the inbound, outbound and dead-letter queues. */
export async function handleQueueBatch(batch: MessageBatch<unknown>, env: AppEnv): Promise<void> {
  const db = createDb(env.DB);
  for (const message of batch.messages) {
    const body = message.body as QueueJob | { queue?: string; body?: unknown };
    try {
      if (batch.queue === 'mailcove-dlq') {
        await recordDeadLetter(env, db, message);
        message.ack();
        continue;
      }
      if (isIngestJob(body)) {
        await processIngestJob(env, db, body);
      } else if (isSendJob(body)) {
        await deliverMessage(env, db, body.messageId);
      } else {
        console.warn('Unknown queue message', body);
      }
      message.ack();
    } catch (error) {
      console.error(`Queue job failed (attempt ${message.attempts})`, error);
      if (message.attempts >= 5 && isSendJob(body)) {
        const row = await db.select().from(messages).where(eq(messages.id, body.messageId)).get();
        if (row && (row.status === 'queued' || row.status === 'sending')) {
          await markFailed(env, db, row, error instanceof Error ? error.message : 'Delivery failed after retries');
        }
      }
      message.retry({ delaySeconds: Math.min(600, 15 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}

async function recordDeadLetter(env: AppEnv, db: Db, message: Message<unknown>): Promise<void> {
  const body = message.body as QueueJob | undefined;
  await db.insert(deadLetters).values({
    id: newId(),
    queue: isSendJob(body) ? 'mailcove-outbound' : 'mailcove-inbound',
    body: JSON.stringify(message.body).slice(0, 50_000),
    error: 'Exhausted retries',
    attempts: message.attempts,
  });
  if (isSendJob(body)) {
    const row = await db.select().from(messages).where(eq(messages.id, body.messageId)).get();
    if (row && (row.status === 'queued' || row.status === 'sending')) {
      await db.update(messages).set({ status: 'failed', statusDetail: 'Delivery failed after retries', statusAt: new Date() }).where(eq(messages.id, row.id));
      await recomputeThread(db, row.threadId);
    }
  }
  void env;
}

function isIngestJob(body: unknown): body is IngestJob {
  return Boolean(body) && typeof body === 'object' && (body as { type?: string }).type === 'ingest';
}

function isSendJob(body: unknown): body is QueueSendMessage {
  return Boolean(body) && typeof body === 'object' && (body as { type?: string }).type === 'send';
}
