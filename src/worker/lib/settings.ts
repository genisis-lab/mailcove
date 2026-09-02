import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { appSettings, users } from '../db/schema';

export type AppSettings = {
  appName: string;
  logoKey: string | null;
  accentColor: string;
  allowSignups: boolean;
  trashRetentionDays: number;
  spamRetentionDays: number;
  maxAttachmentBytes: number;
  maxMessageBytes: number;
  defaultUndoSendSeconds: number;
  requireTwoFactorForAdmins: boolean;
  backupsEnabled: boolean;
  backupRetentionCount: number;
  setupCompleted: boolean;
  publicApiEnabled: boolean;
  inboundCategorization: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  appName: 'Mailcove',
  logoKey: null,
  accentColor: '#4f46e5',
  allowSignups: false,
  trashRetentionDays: 30,
  spamRetentionDays: 30,
  maxAttachmentBytes: 20 * 1024 * 1024,
  maxMessageBytes: 25 * 1024 * 1024,
  defaultUndoSendSeconds: 10,
  requireTwoFactorForAdmins: false,
  backupsEnabled: false,
  backupRetentionCount: 14,
  setupCompleted: false,
  publicApiEnabled: true,
  inboundCategorization: true,
};

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(appSettings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) merged[row.key] = row.value;
  return merged as AppSettings;
}

export async function getSetting<K extends keyof AppSettings>(db: Db, key: K): Promise<AppSettings[K]> {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return (row ? (row.value as AppSettings[K]) : DEFAULT_SETTINGS[key]) as AppSettings[K];
}

export async function setSettings(db: Db, patch: Partial<AppSettings>): Promise<AppSettings> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  for (const [key, value] of entries) {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  return getSettings(db);
}

export async function userCount(db: Db): Promise<number> {
  const row = await db.select({ count: sql<number>`count(*)` }).from(users).get();
  return Number(row?.count ?? 0);
}

export async function isSetupComplete(db: Db): Promise<boolean> {
  const [completed, count] = await Promise.all([getSetting(db, 'setupCompleted'), userCount(db)]);
  return Boolean(completed) && count > 0;
}
