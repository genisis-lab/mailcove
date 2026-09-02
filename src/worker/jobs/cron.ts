import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { createDb, type Db } from '../db/client';
import { attachments, domains, messages, providerEvents, sessions, threads, verifications, webhookDeliveries } from '../db/schema';
import { baseUrl, type AppEnv } from '../env';
import { getSettings } from '../lib/settings';
import { queueSend } from '../mail/outbound/deliver';
import { mailboxUserIds } from '../mail/outbound/recipients';
import { getProvider } from '../mail/providers/registry';
import { deleteMessageObjects } from '../mail/store';
import { publishToUsers } from '../realtime/hub';
import { runBackup } from './backup';

export async function handleScheduled(controller: ScheduledController, env: AppEnv): Promise<void> {
  const db = createDb(env.DB);
  const tasks: Array<[string, () => Promise<unknown>]> = [
    ['wakeSnoozed', () => wakeSnoozed(env, db)],
    ['dispatchScheduled', () => dispatchScheduled(env, db)],
    ['requeueStuck', () => requeueStuck(env, db)],
  ];
  if (controller.cron === '0 3 * * *') {
    tasks.push(
      ['purgeRetention', () => purgeRetention(env, db)],
      ['pruneStagedUploads', () => pruneStagedUploads(env, db)],
      ['cleanupAuth', () => cleanupAuth(db)],
      ['pruneEvents', () => pruneEvents(db)],
      ['recheckDomains', () => recheckDomains(env, db)],
      ['scheduledBackup', () => scheduledBackup(env, db)],
    );
  }
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (error) {
      console.error(`cron task ${name} failed`, error);
    }
  }
}

/** Snoozed threads whose time has come return to the inbox as unread. */
export async function wakeSnoozed(env: AppEnv, db: Db): Promise<number> {
  const due = await db
    .select({ id: threads.id, mailboxId: threads.mailboxId })
    .from(threads)
    .where(and(isNotNull(threads.snoozedUntil), lte(threads.snoozedUntil, new Date())))
    .limit(200);
  if (due.length === 0) return 0;
  await db
    .update(threads)
    .set({ snoozedUntil: null, folder: 'inbox', updatedAt: new Date() })
    .where(inArray(threads.id, due.map((t) => t.id)));
  // Mark the latest message unread so the thread surfaces like new mail.
  for (const t of due) {
    const latest = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.threadId, t.id), isNull(messages.trashedAt)))
      .orderBy(sql`${messages.receivedAt} desc`)
      .limit(1)
      .get();
    if (latest) await db.update(messages).set({ isRead: false }).where(eq(messages.id, latest.id));
    await db.update(threads).set({ unreadCount: sql`max(${threads.unreadCount}, 1)` }).where(eq(threads.id, t.id));
    const users = await mailboxUserIds(db, t.mailboxId);
    await publishToUsers(env, users, { type: 'thread.updated', threadId: t.id, mailboxId: t.mailboxId });
  }
  return due.length;
}

/** Scheduled sends whose time has arrived are pushed to the outbound queue. */
export async function dispatchScheduled(env: AppEnv, db: Db): Promise<number> {
  const due = await db
    .select()
    .from(messages)
    .where(and(eq(messages.status, 'scheduled'), isNotNull(messages.scheduledAt), lte(messages.scheduledAt, new Date())))
    .limit(100);
  for (const message of due) await queueSend(env, db, message, 0);
  return due.length;
}

/** Messages stuck in "sending" for more than ten minutes get another attempt. */
export async function requeueStuck(env: AppEnv, db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const stuck = await db.select().from(messages).where(and(eq(messages.status, 'sending'), lt(messages.statusAt, cutoff))).limit(50);
  for (const message of stuck) await queueSend(env, db, message, 0);
  return stuck.length;
}

/** Permanently deletes trash and spam older than the configured retention windows. */
export async function purgeRetention(env: AppEnv, db: Db): Promise<number> {
  const settings = await getSettings(db);
  let purged = 0;
  for (const [folder, days] of [
    ['trash', settings.trashRetentionDays],
    ['spam', settings.spamRetentionDays],
  ] as const) {
    if (!days || days <= 0) continue;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const old = await db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.folder, folder), lt(threads.updatedAt, cutoff)))
      .limit(200);
    for (const t of old) {
      const rows = await db.select({ id: messages.id, rawR2Key: messages.rawR2Key }).from(messages).where(eq(messages.threadId, t.id));
      for (const m of rows) await deleteMessageObjects(db, env.STORAGE, m);
      await db.delete(threads).where(eq(threads.id, t.id));
      purged++;
    }
  }
  // Individually trashed messages inside live threads.
  const cutoff = new Date(Date.now() - settings.trashRetentionDays * 24 * 3600 * 1000);
  const trashed = await db.select({ id: messages.id, rawR2Key: messages.rawR2Key, threadId: messages.threadId }).from(messages).where(and(isNotNull(messages.trashedAt), lt(messages.trashedAt, cutoff))).limit(200);
  for (const m of trashed) {
    await deleteMessageObjects(db, env.STORAGE, m);
    await db.delete(messages).where(eq(messages.id, m.id));
    purged++;
  }
  return purged;
}

/** Uploads that never got attached to a message are dropped after a day. */
export async function pruneStagedUploads(env: AppEnv, db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const stale = await db.select().from(attachments).where(and(isNull(attachments.messageId), lt(attachments.createdAt, cutoff))).limit(500);
  if (stale.length) {
    await env.STORAGE.delete(stale.map((a) => a.r2Key)).catch(() => undefined);
    await db.delete(attachments).where(inArray(attachments.id, stale.map((a) => a.id)));
  }
  return stale.length;
}

export async function cleanupAuth(db: Db): Promise<void> {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(verifications).where(lt(verifications.expiresAt, now));
}

export async function pruneEvents(db: Db): Promise<void> {
  await db.delete(providerEvents).where(lt(providerEvents.createdAt, new Date(Date.now() - 7 * 24 * 3600 * 1000)));
  await db.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, new Date(Date.now() - 30 * 24 * 3600 * 1000)));
}

/** Refreshes DNS/verification status for every domain so the admin panel stays accurate. */
export async function recheckDomains(env: AppEnv, db: Db): Promise<void> {
  const all = await db.select().from(domains);
  for (const domain of all) {
    try {
      const provider = await getProvider(env, db, domain.provider);
      if (!provider.isConfigured() && domain.provider !== 'cloudflare') continue;
      const info = await provider.getDomain(domain.name, domain.providerDomainId, { appBaseUrl: baseUrl(env), workerName: env.EMAIL_WORKER_NAME });
      await db
        .update(domains)
        .set({
          status: info.status,
          sendingEnabled: info.sendingEnabled,
          receivingEnabled: info.receivingEnabled,
          dnsRecords: info.records,
          providerDomainId: info.providerDomainId ?? domain.providerDomainId,
          zoneId: info.zoneId ?? domain.zoneId,
          lastCheckedAt: new Date(),
          verifiedAt: info.status === 'verified' ? (domain.verifiedAt ?? new Date()) : domain.verifiedAt,
          lastError: null,
        })
        .where(eq(domains.id, domain.id));
    } catch (error) {
      await db.update(domains).set({ lastCheckedAt: new Date(), lastError: error instanceof Error ? error.message : String(error) }).where(eq(domains.id, domain.id));
    }
  }
}

export async function scheduledBackup(env: AppEnv, db: Db): Promise<void> {
  const settings = await getSettings(db);
  if (!settings.backupsEnabled) return;
  await runBackup(env, db, 'scheduled');
}
