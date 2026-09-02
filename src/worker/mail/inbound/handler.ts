import { createDb } from '../../db/client';
import type { AppEnv } from '../../env';
import { newId } from '../../lib/crypto';
import { getSetting } from '../../lib/settings';
import { processIngestJob, type IngestJob } from '../../jobs/queue';
import { rawKey, storeRaw } from '../store';
import { routeRecipient } from './route';

/**
 * Cloudflare Email Routing entry point. Kept deliberately short: decide
 * accept/reject, park the raw MIME in R2, and hand the heavy lifting to the
 * inbound queue so the SMTP session completes quickly.
 */
export async function handleInboundEmail(message: ForwardableEmailMessage, env: AppEnv, ctx: ExecutionContext): Promise<void> {
  const db = createDb(env.DB);

  const maxBytes = await getSetting(db, 'maxMessageBytes');
  if (message.rawSize > maxBytes) {
    message.setReject(`Message too large (limit ${Math.floor(maxBytes / (1024 * 1024))} MB)`);
    return;
  }

  const route = await routeRecipient(db, message.to);
  if (route.kind === 'unknown_domain') {
    message.setReject('Recipient domain is not configured on this server');
    return;
  }
  if (route.kind === 'disabled') {
    message.setReject('Mailbox is disabled');
    return;
  }
  if (route.kind === 'unrouted' && route.policy === 'reject') {
    message.setReject('No such user here');
    return;
  }

  const id = newId();
  const key = rawKey(id);
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  await storeRaw(env.STORAGE, key, raw, { from: message.from.slice(0, 500), to: message.to.slice(0, 500) });

  const job: IngestJob = {
    type: 'ingest',
    provider: 'cloudflare',
    eventId: `cf:${id}`,
    providerMessageId: message.headers.get('message-id')?.trim() || `cf-${id}`,
    envelopeFrom: message.from,
    envelopeTo: [message.to],
    rawKey: key,
  };

  try {
    await env.INBOUND_QUEUE.send(job);
  } catch (error) {
    // Queue unavailable (local dev without queues, transient outage): process inline.
    console.warn('INBOUND_QUEUE.send failed, processing inline', error);
    ctx.waitUntil(processIngestJob(env, db, job));
  }
}
