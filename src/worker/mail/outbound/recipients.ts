import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { mailboxAccess, mailboxes } from '../../db/schema';

/** Every user who can see a mailbox: the owner plus delegated users. */
export async function mailboxUserIds(db: Db, mailboxId: string): Promise<string[]> {
  const mailbox = await db.select({ ownerUserId: mailboxes.ownerUserId }).from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();
  const shared = await db.select({ userId: mailboxAccess.userId }).from(mailboxAccess).where(eq(mailboxAccess.mailboxId, mailboxId));
  const ids = new Set<string>();
  if (mailbox?.ownerUserId) ids.add(mailbox.ownerUserId);
  for (const row of shared) ids.add(row.userId);
  return [...ids];
}
