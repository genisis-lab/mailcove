import { and, eq } from 'drizzle-orm';
import { domainOf, normalizeEmail, stripPlusTag } from '../../../shared/address';
import type { Db } from '../../db/client';
import { domains, mailboxAliases, mailboxes, type Domain, type Mailbox } from '../../db/schema';

export type RouteResult =
  | { kind: 'mailbox'; mailbox: Mailbox; domain: Domain; recipient: string; viaCatchAll: boolean; viaAlias: boolean }
  | { kind: 'unknown_domain'; recipient: string }
  | { kind: 'unrouted'; recipient: string; domain: Domain; policy: 'unrouted' | 'reject' }
  | { kind: 'disabled'; recipient: string; domain: Domain; mailbox: Mailbox };

/**
 * Maps a recipient address to a mailbox: exact address → alias → plus-tag
 * stripped → domain catch-all → unrouted/reject per domain policy.
 */
export async function routeRecipient(db: Db, rawRecipient: string): Promise<RouteResult> {
  const recipient = normalizeEmail(rawRecipient);
  const domainName = domainOf(recipient);
  const domain = domainName ? await db.select().from(domains).where(eq(domains.name, domainName)).get() : undefined;
  if (!domain) return { kind: 'unknown_domain', recipient };

  const candidates = [recipient];
  const stripped = stripPlusTag(recipient);
  if (stripped !== recipient) candidates.push(stripped);

  for (const candidate of candidates) {
    const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.address, candidate)).get();
    if (mailbox) {
      if (mailbox.disabled) return { kind: 'disabled', recipient, domain, mailbox };
      return { kind: 'mailbox', mailbox, domain, recipient, viaCatchAll: false, viaAlias: false };
    }
    const alias = await db
      .select({ mailbox: mailboxes })
      .from(mailboxAliases)
      .innerJoin(mailboxes, eq(mailboxes.id, mailboxAliases.mailboxId))
      .where(and(eq(mailboxAliases.address, candidate)))
      .get();
    if (alias) {
      if (alias.mailbox.disabled) return { kind: 'disabled', recipient, domain, mailbox: alias.mailbox };
      return { kind: 'mailbox', mailbox: alias.mailbox, domain, recipient, viaCatchAll: false, viaAlias: true };
    }
  }

  if (domain.catchallMailboxId) {
    const mailbox = await db.select().from(mailboxes).where(eq(mailboxes.id, domain.catchallMailboxId)).get();
    if (mailbox && !mailbox.disabled) {
      return { kind: 'mailbox', mailbox, domain, recipient, viaCatchAll: true, viaAlias: false };
    }
  }

  return { kind: 'unrouted', recipient, domain, policy: domain.unknownRecipientPolicy };
}

/** Routes every recipient and groups by mailbox so a message is stored once per mailbox. */
export async function routeRecipients(db: Db, recipients: string[]): Promise<{ routes: RouteResult[]; byMailbox: Map<string, Extract<RouteResult, { kind: 'mailbox' }>> }> {
  const routes: RouteResult[] = [];
  const byMailbox = new Map<string, Extract<RouteResult, { kind: 'mailbox' }>>();
  for (const recipient of [...new Set(recipients.map(normalizeEmail).filter(Boolean))]) {
    const route = await routeRecipient(db, recipient);
    routes.push(route);
    if (route.kind === 'mailbox' && !byMailbox.has(route.mailbox.id)) byMailbox.set(route.mailbox.id, route);
  }
  return { routes, byMailbox };
}
