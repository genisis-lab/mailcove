import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { requireMailbox, resolveMailboxScope } from '../auth/access';
import { currentUser, requireScope } from '../auth/context';
import { attachments, domains, messages } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest } from '../lib/http';
import { ingestMail } from '../mail/inbound/ingest';
import { splitMbox } from '../mail/mbox';
import { buildMime } from '../mail/mime';
import { parseRawMail } from '../mail/parse';
import { loadAttachment, rawKey, storeRaw } from '../mail/store';
import { newId } from '../lib/crypto';
import { router } from './router';

export const importExportRoutes = router();
// Auth is per-route via requireScope so unknown /api/* paths 404 instead of 401.

/** Streams every message in scope as an mbox archive. */
importExportRoutes.get('/export/mbox', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const mailboxIds = await resolveMailboxScope(db, user, c.req.query('mailbox'));
  if (mailboxIds.length === 0) throw badRequest('no_mailboxes');
  const env = c.env;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let cursor: Date | null = null;
        for (;;) {
          const batch = await db
            .select()
            .from(messages)
            .where(
              and(
                inArray(messages.mailboxId, mailboxIds),
                isNull(messages.trashedAt),
                eq(messages.isDraft, false),
                ...(cursor ? [gt(messages.receivedAt, cursor)] : []),
              ),
            )
            .orderBy(asc(messages.receivedAt), asc(messages.id))
            .limit(200);
          if (batch.length === 0) break;
          for (const message of batch) {
            let raw: string | null = null;
            if (message.rawR2Key) {
              const object = await env.STORAGE.get(message.rawR2Key);
              if (object) raw = await object.text();
            }
            if (!raw) {
              const files = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
              const loaded = [];
              for (const f of files) {
                const content = await loadAttachment(env.STORAGE, f.r2Key);
                if (content) loaded.push({ filename: f.filename, contentType: f.contentType, content, contentId: f.contentId, disposition: f.disposition });
              }
              raw = buildMime({
                from: { email: message.fromAddr, name: message.fromName },
                to: message.to,
                cc: message.cc,
                subject: message.subject,
                date: message.sentAt ?? message.receivedAt,
                messageId: message.messageId,
                inReplyTo: message.inReplyTo,
                references: message.referencesHeader,
                text: message.textBody,
                html: message.htmlBody,
                attachments: loaded,
              });
            }
            const escaped = raw.replace(/\r\n/g, '\n').replace(/^(>*From )/gm, '>$1');
            controller.enqueue(encoder.encode(`From ${message.fromAddr || 'MAILER-DAEMON'} ${(message.sentAt ?? message.receivedAt).toUTCString()}\n${escaped}\n\n`));
          }
          cursor = batch[batch.length - 1]!.receivedAt;
          if (batch.length < 200) break;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  await audit(db, { actorUserId: user.id, action: 'mail.export', metadata: { mailboxes: mailboxIds.length } });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/mbox',
      'Content-Disposition': `attachment; filename="mailcove-export-${new Date().toISOString().slice(0, 10)}.mbox"`,
    },
  });
});

/** Imports .eml or .mbox files into a mailbox the caller owns. */
importExportRoutes.post('/import', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const form = await c.req.formData();
  const mailboxId = String(form.get('mailboxId') ?? '');
  if (!mailboxId) throw badRequest('mailbox_required');
  const mailbox = await requireMailbox(db, user, mailboxId, 'full_access');
  const domain = await db.select().from(domains).where(eq(domains.id, mailbox.domainId)).get();
  if (!domain) throw badRequest('domain_missing');
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (files.length === 0) throw badRequest('file_required', 'Attach one or more .eml or .mbox files.');

  let imported = 0;
  let failed = 0;
  for (const file of files) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const rawMessages = file.name.toLowerCase().endsWith('.mbox') || file.type === 'application/mbox' ? splitMbox(buffer) : [buffer];
    for (const raw of rawMessages) {
      try {
        const parsed = await parseRawMail(raw);
        const key = rawKey(newId());
        await storeRaw(c.env.STORAGE, key, raw, { imported: '1' });
        await ingestMail(c.env, db, parsed, {
          provider: domain.provider,
          providerMessageId: parsed.messageId ?? `import-${newId()}`,
          envelopeFrom: parsed.from.email,
          envelopeTo: [mailbox.address],
          rawKey: key,
        });
        imported++;
      } catch (error) {
        failed++;
        console.warn('import failed', error);
      }
    }
  }
  await audit(db, { actorUserId: user.id, action: 'mail.import', targetType: 'mailbox', targetId: mailbox.id, metadata: { imported, failed } });
  return c.json({ imported, failed });
});
