import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import type { Db } from '../db/client';
import { pushSubscriptions } from '../db/schema';
import type { AppEnv } from '../env';

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  icon?: string;
  threadId?: string;
  messageId?: string;
};

export function pushConfigured(env: AppEnv): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export async function sendPushToUsers(env: AppEnv, db: Db, userIds: string[], payload: PushPayload): Promise<void> {
  if (!pushConfigured(env) || userIds.length === 0) return;
  const rows = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
  if (rows.length === 0) return;

  const subject = env.VAPID_SUBJECT?.trim() || `mailto:admin@${new URL(env.APP_BASE_URL).hostname}`;
  const body = JSON.stringify(payload);
  const stale: string[] = [];

  await Promise.all(
    rows.map(async (sub) => {
      try {
        // Build the encrypted request ourselves and send it with fetch so no
        // Node https module is needed inside the Worker.
        const details = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          {
            TTL: 60 * 60,
            urgency: 'high',
            vapidDetails: { subject, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
          },
        );
        const response = await fetch(details.endpoint, {
          method: details.method,
          headers: details.headers as Record<string, string>,
          body: details.body as Uint8Array<ArrayBuffer>,
        });
        if (response.status === 404 || response.status === 410) stale.push(sub.id);
        else if (!response.ok) console.warn('push rejected', response.status, await response.text().catch(() => ''));
      } catch (error) {
        console.warn('push send failed', error);
      }
    }),
  );

  if (stale.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, stale));
}

export async function removeSubscription(db: Db, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}
