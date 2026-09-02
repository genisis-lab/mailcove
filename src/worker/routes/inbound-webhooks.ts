import { eq } from 'drizzle-orm';
import type { MailProviderKind } from '../../shared/types';
import type { Db } from '../db/client';
import { providerEvents } from '../db/schema';
import type { AppEnv } from '../env';
import { newId } from '../lib/crypto';
import { rateLimit } from '../lib/rate-limit';
import { processIngestJob, type IngestJob } from '../jobs/queue';
import { ingestMail } from '../mail/inbound/ingest';
import { applyDeliveryEvent } from '../mail/outbound/deliver';
import { getProvider, isProviderKind } from '../mail/providers/registry';
import { ProviderError, type InboundEvent } from '../mail/providers/types';
import { rawKey, storeRaw } from '../mail/store';
import { router } from './router';

export const inboundWebhookRoutes = router();

/** Claims a provider event id; returns false when it was already processed. */
async function claimEvent(db: Db, provider: MailProviderKind, eventId: string, type: string): Promise<boolean> {
  const result = await db.insert(providerEvents).values({ id: `${provider}:${eventId}`, provider, type }).onConflictDoNothing().returning({ id: providerEvents.id });
  return result.length > 0;
}

async function releaseEvent(db: Db, provider: MailProviderKind, eventId: string): Promise<void> {
  await db.delete(providerEvents).where(eq(providerEvents.id, `${provider}:${eventId}`));
}

inboundWebhookRoutes.post('/:provider', rateLimit('WEBHOOK_RATE_LIMITER'), async (c) => {
  const kind = c.req.param('provider');
  if (!isProviderKind(kind) || kind === 'cloudflare') return c.json({ error: { code: 'unknown_provider' } }, 404);
  const env = c.env;
  const db = c.var.db;
  const provider = await getProvider(env, db, kind);
  if (!provider.handleWebhook) return c.json({ error: { code: 'no_webhook_support' } }, 404);

  let result;
  try {
    result = await provider.handleWebhook(c.req.raw);
  } catch (error) {
    if (error instanceof ProviderError) {
      console.warn(`${kind} webhook rejected`, error.code, error.message);
      return c.json({ error: { code: error.code, message: error.message } }, error.status === 401 ? 401 : 400);
    }
    throw error;
  }

  let accepted = 0;
  for (const event of result.events) {
    const fresh = await claimEvent(db, kind, event.eventId, event.kind === 'inbound' ? 'inbound' : event.type);
    if (!fresh) continue;
    accepted++;
    if (event.kind === 'delivery') {
      c.executionCtx.waitUntil(applyDeliveryEvent(env, db, event).catch((err) => console.error('delivery event failed', err)));
      continue;
    }
    await handleInboundEvent(env, db, c.executionCtx, event);
  }
  return result.response ?? c.json({ ok: true, accepted });
});

async function handleInboundEvent(env: AppEnv, db: Db, ctx: { waitUntil(promise: Promise<unknown>): void }, event: InboundEvent): Promise<void> {
  const base = {
    type: 'ingest' as const,
    provider: event.provider,
    eventId: event.eventId,
    providerMessageId: event.providerMessageId,
    envelopeFrom: event.envelopeFrom,
    envelopeTo: event.envelopeTo,
  };
  if (event.raw) {
    const key = rawKey(newId());
    await storeRaw(env.STORAGE, key, event.raw, { from: event.envelopeFrom.slice(0, 500), to: event.envelopeTo.join(',').slice(0, 500) });
    await enqueue(env, db, { ...base, rawKey: key });
    return;
  }
  if (event.fetchRef) {
    await enqueue(env, db, { ...base, fetchRef: event.fetchRef });
    return;
  }
  if (event.parsed) {
    // Payload already carries the content (and possibly megabytes of
    // attachments), so process it here rather than squeezing it into a queue message.
    const parsed = event.parsed;
    ctx.waitUntil(
      ingestMail(env, db, parsed, {
        provider: event.provider,
        providerMessageId: event.providerMessageId,
        envelopeFrom: event.envelopeFrom,
        envelopeTo: event.envelopeTo,
        rawKey: null,
      }).catch(async (error) => {
        console.error('inline ingest failed', error);
        await releaseEvent(db, event.provider, event.eventId);
      }),
    );
  }
}

async function enqueue(env: AppEnv, db: Db, job: IngestJob): Promise<void> {
  try {
    await env.INBOUND_QUEUE.send(job);
  } catch (error) {
    console.warn('INBOUND_QUEUE unavailable, processing inline', error);
    await processIngestJob(env, db, job);
  }
}
