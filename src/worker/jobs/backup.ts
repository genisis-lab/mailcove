import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { backups, type Backup } from '../db/schema';
import type { AppEnv } from '../env';
import { newId } from '../lib/crypto';
import { getSetting } from '../lib/settings';

/** Tables included in a logical backup, in dependency order for restore. */
export const BACKUP_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'two_factor',
  'domains',
  'mailboxes',
  'mailbox_aliases',
  'mailbox_access',
  'threads',
  'messages',
  'attachments',
  'labels',
  'thread_labels',
  'filters',
  'contacts',
  'blocked_senders',
  'templates',
  'auto_reply_log',
  'api_keys',
  'webhooks',
  'webhook_deliveries',
  'push_subscriptions',
  'audit_logs',
  'unrouted_messages',
  'provider_events',
  'provider_credentials',
  'app_settings',
  'delivery_events',
  'backups',
  'dead_letters',
] as const;

export type BackupDocument = {
  format: 'mailcove-backup';
  version: 1;
  createdAt: string;
  tables: Record<string, unknown[]>;
};

const PAGE = 500;

export async function runBackup(env: AppEnv, db: Db, trigger: 'manual' | 'scheduled'): Promise<Backup> {
  const id = newId();
  await db.insert(backups).values({ id, status: 'running', trigger });
  try {
    const known = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '%_fts%' and name != 'd1_migrations' and name != '_cf_KV'`);
    const missing = known.map((r) => r.name).filter((name) => !(BACKUP_TABLES as readonly string[]).includes(name));
    if (missing.length) console.warn('Tables not covered by backup', missing);

    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await db.all(sql.raw(`select * from "${table}" limit ${PAGE} offset ${offset}`));
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      tables[table] = rows;
      counts[table] = rows.length;
    }
    const doc: BackupDocument = { format: 'mailcove-backup', version: 1, createdAt: new Date().toISOString(), tables };
    const body = JSON.stringify(doc);
    const filename = `mailcove-backup-${doc.createdAt.replace(/[:.]/g, '-')}.json`;
    const key = `backups/${filename}`;
    await env.STORAGE.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    await db
      .update(backups)
      .set({ status: 'completed', r2Key: key, filename, sizeBytes: body.length, tableCounts: counts, completedAt: new Date() })
      .where(eq(backups.id, id));
    await enforceRetention(env, db);
  } catch (error) {
    await db.update(backups).set({ status: 'failed', error: error instanceof Error ? error.message : String(error), completedAt: new Date() }).where(eq(backups.id, id));
  }
  return (await db.select().from(backups).where(eq(backups.id, id)).get())!;
}

async function enforceRetention(env: AppEnv, db: Db): Promise<void> {
  const keep = await getSetting(db, 'backupRetentionCount');
  const completed = await db.select().from(backups).where(eq(backups.status, 'completed')).orderBy(desc(backups.createdAt));
  for (const old of completed.slice(Math.max(1, keep))) {
    if (old.r2Key) await env.STORAGE.delete(old.r2Key).catch(() => undefined);
    await db.delete(backups).where(eq(backups.id, old.id));
  }
}

/**
 * Restores a backup document. Wipes every covered table (reverse dependency
 * order) and re-inserts rows in batches. Callers must have verified the admin
 * really wants this.
 */
export async function restoreBackup(d1: D1Database, doc: BackupDocument): Promise<Record<string, number>> {
  if (doc.format !== 'mailcove-backup') throw new Error('Not a Mailcove backup');
  const counts: Record<string, number> = {};
  const deletes = [...BACKUP_TABLES]
    .reverse()
    .filter((t) => t !== 'backups')
    .map((table) => d1.prepare(`delete from "${table}"`));
  await d1.batch([d1.prepare('PRAGMA defer_foreign_keys = ON'), ...deletes]);

  for (const table of BACKUP_TABLES) {
    if (table === 'backups') continue;
    const rows = (doc.tables[table] ?? []) as Array<Record<string, unknown>>;
    counts[table] = rows.length;
    for (let i = 0; i < rows.length; i += 50) {
      const statements = rows.slice(i, i + 50).flatMap((row) => {
        const columns = Object.keys(row);
        if (!columns.length) return [];
        const placeholders = columns.map(() => '?').join(', ');
        const stmt = `insert or replace into "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) values (${placeholders})`;
        const values = columns.map((c) => {
          const v = row[c];
          return v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
        });
        return [d1.prepare(stmt).bind(...(values as (string | number | null)[]))];
      });
      if (statements.length) await d1.batch(statements);
    }
  }
  return counts;
}
