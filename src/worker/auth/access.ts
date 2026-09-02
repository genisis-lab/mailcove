import { and, eq, inArray, or } from 'drizzle-orm';
import type { MailboxPermission } from '../../shared/types';
import type { Db } from '../db/client';
import { domains, mailboxAccess, mailboxes, threads, type Mailbox, type Thread, type User } from '../db/schema';
import { forbidden, notFound } from '../lib/http';

const PERMISSION_RANK: Record<MailboxPermission, number> = { read_only: 1, send_as: 2, full_access: 3 };

export type AccessibleMailbox = {
  mailbox: Mailbox;
  domainName: string;
  permission: MailboxPermission;
  isOwner: boolean;
};

export async function accessibleMailboxes(db: Db, user: User): Promise<AccessibleMailbox[]> {
  const owned = await db
    .select({ mailbox: mailboxes, domainName: domains.name })
    .from(mailboxes)
    .innerJoin(domains, eq(domains.id, mailboxes.domainId))
    .where(eq(mailboxes.ownerUserId, user.id));

  const shared = await db
    .select({ mailbox: mailboxes, domainName: domains.name, permission: mailboxAccess.permission })
    .from(mailboxAccess)
    .innerJoin(mailboxes, eq(mailboxes.id, mailboxAccess.mailboxId))
    .innerJoin(domains, eq(domains.id, mailboxes.domainId))
    .where(eq(mailboxAccess.userId, user.id));

  const result = new Map<string, AccessibleMailbox>();
  for (const row of owned) {
    result.set(row.mailbox.id, { mailbox: row.mailbox, domainName: row.domainName, permission: 'full_access', isOwner: true });
  }
  for (const row of shared) {
    if (result.has(row.mailbox.id)) continue;
    result.set(row.mailbox.id, { mailbox: row.mailbox, domainName: row.domainName, permission: row.permission, isOwner: false });
  }
  return [...result.values()].sort((a, b) => a.mailbox.address.localeCompare(b.mailbox.address));
}

export async function accessibleMailboxIds(db: Db, user: User): Promise<string[]> {
  const rows = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .leftJoin(mailboxAccess, and(eq(mailboxAccess.mailboxId, mailboxes.id), eq(mailboxAccess.userId, user.id)))
    .where(or(eq(mailboxes.ownerUserId, user.id), eq(mailboxAccess.userId, user.id)));
  return [...new Set(rows.map((r) => r.id))];
}

export async function mailboxPermission(db: Db, user: User, mailboxId: string): Promise<MailboxPermission | null> {
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();
  if (!mailbox) return null;
  if (mailbox.ownerUserId === user.id) return 'full_access';
  const access = await db
    .select()
    .from(mailboxAccess)
    .where(and(eq(mailboxAccess.mailboxId, mailboxId), eq(mailboxAccess.userId, user.id)))
    .get();
  return access?.permission ?? null;
}

export async function requireMailbox(
  db: Db,
  user: User,
  mailboxId: string,
  minimum: MailboxPermission = 'read_only',
): Promise<Mailbox> {
  const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();
  if (!mailbox) throw notFound('Mailbox');
  const permission = await mailboxPermission(db, user, mailboxId);
  if (!permission || PERMISSION_RANK[permission] < PERMISSION_RANK[minimum]) {
    throw forbidden('You do not have access to this mailbox');
  }
  return mailbox;
}

export async function requireThread(
  db: Db,
  user: User,
  threadId: string,
  minimum: MailboxPermission = 'read_only',
): Promise<Thread> {
  const thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (!thread) throw notFound('Conversation');
  await requireMailbox(db, user, thread.mailboxId, minimum);
  return thread;
}

/** Filters a requested mailbox selection down to the ones the user can read. */
export async function resolveMailboxScope(db: Db, user: User, requested?: string | null): Promise<string[]> {
  const all = await accessibleMailboxIds(db, user);
  if (!requested || requested === 'all') return all;
  const wanted = requested.split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = wanted.filter((id) => all.includes(id));
  if (allowed.length === 0) throw forbidden('You do not have access to the requested mailbox');
  return allowed;
}

export async function mailboxesByIds(db: Db, ids: string[]): Promise<Mailbox[]> {
  if (ids.length === 0) return [];
  return db.select().from(mailboxes).where(inArray(mailboxes.id, ids));
}

export function permissionAtLeast(actual: MailboxPermission, minimum: MailboxPermission): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[minimum];
}
