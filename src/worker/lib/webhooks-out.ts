import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { WebhookEvent } from '../../shared/types';
import type { Db } from '../db/client';
import { webhookDeliveries, webhooks } from '../db/schema';
import { hexEncode, hmacSha256, newId } from './crypto';

/**
 * Delivers an event to every enabled outgoing webhook owned by the given users
 * (or global admin webhooks). Signed with HMAC-SHA256 in `X-Mailcove-Signature`.
 */
export async function dispatchWebhooks(db: Db, userIds: string[], event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.enabled, true), userIds.length ? or(isNull(webhooks.userId), inArray(webhooks.userId, userIds)) : isNull(webhooks.userId)));
  const targets = rows.filter((w) => w.events.includes(event));
  if (targets.length === 0) return;

  const body = JSON.stringify({ id: newId(), event, createdAt: new Date().toISOString(), data: payload });
  await Promise.all(
    targets.map(async (hook) => {
      const started = Date.now();
      const timestamp = Math.floor(started / 1000).toString();
      const signature = hexEncode(await hmacSha256(hook.secret, `${timestamp}.${body}`));
      let statusCode: number | null = null;
      let error: string | null = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mailcove-Webhooks/1.0',
            'X-Mailcove-Event': event,
            'X-Mailcove-Timestamp': timestamp,
            'X-Mailcove-Signature': `v1=${signature}`,
          },
          body,
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timer);
        statusCode = response.status;
        if (!response.ok) error = `HTTP ${response.status}`;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      await db.insert(webhookDeliveries).values({
        id: newId(),
        webhookId: hook.id,
        event,
        payload: body.length > 20_000 ? body.slice(0, 20_000) : body,
        statusCode,
        error,
        durationMs: Date.now() - started,
      });
      await db.update(webhooks).set({ lastStatus: statusCode, lastDeliveredAt: new Date() }).where(eq(webhooks.id, hook.id));
    }),
  );
}
