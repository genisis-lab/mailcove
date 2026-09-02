import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isValidEmail, normalizeEmail, uniqueAddresses } from '../../shared/address';
import { canUndoSend } from '../../shared/mail';
import { htmlToText } from '../../shared/text';
import type { Address } from '../../shared/types';
import { accessibleMailboxIds, mailboxPermission, requireMailbox, requireThread } from '../auth/access';
import { currentUser, requireScope, requireUser } from '../auth/context';
import type { Db } from '../db/client';
import { attachments, contacts, domains, mailboxAliases, messages, type User } from '../db/schema';
import { undoSendSeconds, type AppEnv } from '../env';
import { audit } from '../lib/audit';
import { badRequest, contentDisposition, forbidden, HttpError, notFound } from '../lib/http';
import { rateLimit } from '../lib/rate-limit';
import { getSettings } from '../lib/settings';
import { buildMime } from '../mail/mime';
import { composeMessage } from '../mail/outbound/compose';
import { queueSend } from '../mail/outbound/deliver';
import { PROVIDER_CAPABILITIES } from '../mail/providers/registry';
import { deleteMessageObjects, loadAttachment, uploadKey } from '../mail/store';
import { recomputeThread } from '../mail/threads';
import { publishToUser } from '../realtime/hub';
import { parsePrefs } from './me';
import { router } from './router';
import { newId } from '../lib/crypto';

export const messageRoutes = router();
messageRoutes.use('*', requireUser);

const addressSchema = z.object({ email: z.string().trim().max(254), name: z.string().trim().max(200).nullable().optional() });

export const composeSchema = z.object({
  mailboxId: z.string(),
  fromAddress: z.string().trim().optional(),
  to: z.array(addressSchema).max(100).default([]),
  cc: z.array(addressSchema).max(100).default([]),
  bcc: z.array(addressSchema).max(100).default([]),
  replyTo: addressSchema.nullable().optional(),
  subject: z.string().max(998).default(''),
  html: z.string().max(2_000_000).nullable().optional(),
  text: z.string().max(2_000_000).nullable().optional(),
  uploadIds: z.array(z.string()).max(50).default([]),
  replyToMessageId: z.string().nullable().optional(),
  forwardOfMessageId: z.string().nullable().optional(),
  includeOriginalAttachments: z.boolean().optional(),
  sendMode: z.enum(['reply', 'reply_all', 'forward', 'new']).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  draftId: z.string().nullable().optional(),
});
export type ComposeBody = z.infer<typeof composeSchema>;

function cleanAddresses(list: Array<{ email: string; name?: string | null }>, label: string): Address[] {
  const out: Address[] = [];
  for (const a of list) {
    const email = normalizeEmail(a.email);
    if (!isValidEmail(email)) throw badRequest('invalid_recipient', `"${a.email}" in ${label} is not a valid email address.`);
    out.push({ email, name: a.name ?? null });
  }
  return uniqueAddresses(out);
}

async function resolveFrom(db: Db, user: User, body: ComposeBody) {
  const mailbox = await requireMailbox(db, user, body.mailboxId, 'send_as');
  const domain = await db.select().from(domains).where(eq(domains.id, mailbox.domainId)).get();
  if (!domain) throw notFound('Domain');
  if (mailbox.disabled) throw forbidden('This mailbox is disabled.');
  let fromEmail = mailbox.address;
  if (body.fromAddress && normalizeEmail(body.fromAddress) !== mailbox.address) {
    const alias = await db
      .select()
      .from(mailboxAliases)
      .where(and(eq(mailboxAliases.mailboxId, mailbox.id), eq(mailboxAliases.address, normalizeEmail(body.fromAddress))))
      .get();
    if (!alias) throw forbidden('You can only send from this mailbox or one of its aliases.');
    fromEmail = alias.address;
  }
  const permission = await mailboxPermission(db, user, mailbox.id);
  const onBehalf = permission === 'send_as' && mailbox.ownerUserId !== user.id && mailbox.type === 'shared';
  const displayName = mailbox.displayName?.trim() || (mailbox.ownerUserId === user.id ? user.name : null);
  const from: Address = { email: fromEmail, name: onBehalf ? `${user.name} for ${displayName ?? mailbox.address}` : (displayName ?? user.name) };
  return { mailbox, domain, from };
}

async function originalAttachments(env: AppEnv, db: Db, user: User, messageId: string) {
  const original = await db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!original) return [];
  await requireThread(db, user, original.threadId);
  const files = await db.select().from(attachments).where(eq(attachments.messageId, original.id));
  const out = [];
  for (const f of files) {
    const content = await loadAttachment(env.STORAGE, f.r2Key);
    if (content) out.push({ filename: f.filename, contentType: f.contentType, content, disposition: f.disposition, contentId: f.contentId });
  }
  return out;
}

async function validateSize(db: Db, provider: keyof typeof PROVIDER_CAPABILITIES, body: ComposeBody, extraBytes: number) {
  const caps = PROVIDER_CAPABILITIES[provider];
  const recipients = body.to.length + body.cc.length + body.bcc.length;
  if (recipients > caps.maxRecipients) throw badRequest('too_many_recipients', `${caps.label} allows at most ${caps.maxRecipients} recipients per message.`);
  const uploads = body.uploadIds.length
    ? await db.select({ size: attachments.sizeBytes }).from(attachments).where(inArray(attachments.id, body.uploadIds))
    : [];
  const attachmentBytes = uploads.reduce((n, u) => n + u.size, 0) + extraBytes;
  const bodyBytes = (body.html?.length ?? 0) + (body.text?.length ?? 0);
  // base64 inflates attachments by ~37%.
  const estimated = bodyBytes + Math.ceil(attachmentBytes * 1.37);
  if (estimated > caps.maxMessageBytes) {
    throw badRequest('message_too_large', `This message is about ${(estimated / 1024 / 1024).toFixed(1)} MB; ${caps.label} allows ${(caps.maxMessageBytes / 1024 / 1024).toFixed(0)} MB.`);
  }
  if (uploads.length > caps.maxAttachments) throw badRequest('too_many_attachments', `${caps.label} allows at most ${caps.maxAttachments} attachments.`);
}

/** Compose and send (or schedule) a message. */
messageRoutes.post('/send', requireScope('mail:send'), rateLimit('SEND_RATE_LIMITER', 'user'), zValidator('json', composeSchema), async (c) => {
  const body = c.req.valid('json');
  const user = currentUser(c);
  const db = c.var.db;
  const { mailbox, domain, from } = await resolveFrom(db, user, body);
  const to = cleanAddresses(body.to, 'To');
  const cc = cleanAddresses(body.cc, 'Cc');
  const bcc = cleanAddresses(body.bcc, 'Bcc');
  if (to.length + cc.length + bcc.length === 0) throw badRequest('no_recipients', 'Add at least one recipient.');

  const extra = body.forwardOfMessageId && body.includeOriginalAttachments ? await originalAttachments(c.env, db, user, body.forwardOfMessageId) : [];
  await validateSize(db, domain.provider, body, extra.reduce((n, a) => n + a.content.byteLength, 0));

  if (body.draftId) {
    const draft = await db.select().from(messages).where(and(eq(messages.id, body.draftId), eq(messages.mailboxId, mailbox.id), eq(messages.isDraft, true))).get();
    if (!draft) throw notFound('Draft');
  }

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  const message = await composeMessage(db, {
    mailbox,
    domain,
    authorUserId: user.id,
    from,
    to,
    cc,
    bcc,
    replyTo: body.replyTo?.email ? { email: normalizeEmail(body.replyTo.email), name: body.replyTo.name ?? null } : null,
    subject: body.subject,
    html: body.html ?? null,
    text: body.text ?? null,
    uploadIds: body.uploadIds,
    rawAttachments: extra,
    replyToMessageId: body.replyToMessageId ?? null,
    forwardOfMessageId: body.forwardOfMessageId ?? null,
    sendMode: body.sendMode ?? (body.replyToMessageId ? 'reply' : body.forwardOfMessageId ? 'forward' : 'new'),
    scheduledAt,
    existingDraftId: body.draftId ?? null,
    bucket: c.env.STORAGE,
  });

  // Remember recipients for autocomplete.
  for (const a of [...to, ...cc, ...bcc]) {
    await db
      .insert(contacts)
      .values({ id: newId(), userId: user.id, email: a.email, name: a.name ?? null, source: 'outbound', frequency: 1, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.email],
        set: { frequency: sql`${contacts.frequency} + 1`, lastSeenAt: new Date(), name: sql`coalesce(${contacts.name}, ${a.name ?? null})` },
      });
  }

  let undoUntil: string | null = null;
  if (message.status === 'scheduled') {
    await publishToUser(c.env, user.id, { type: 'thread.updated', threadId: message.threadId, mailboxId: mailbox.id });
  } else {
    const settings = await getSettings(db);
    const prefs = parsePrefs(user.prefs);
    const delay = Math.min(undoSendSeconds(c.env), prefs.undoSendSeconds ?? settings.defaultUndoSendSeconds);
    await queueSend(c.env, db, message, delay);
    undoUntil = new Date(Date.now() + delay * 1000).toISOString();
    await publishToUser(c.env, user.id, { type: 'thread.updated', threadId: message.threadId, mailboxId: mailbox.id });
  }
  await audit(db, { actorUserId: user.id, action: message.status === 'scheduled' ? 'mail.schedule' : 'mail.send', targetType: 'message', targetId: message.id, metadata: { mailbox: mailbox.address, recipients: to.length + cc.length + bcc.length } });
  return c.json({ message: await db.select().from(messages).where(eq(messages.id, message.id)).get(), undoUntil });
});

/** Cancel a queued send while the undo window is open. */
messageRoutes.post('/:id/undo', requireScope('mail:send'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireMailbox(db, user, message.mailboxId, 'send_as');
  if (!canUndoSend(message.status)) {
    throw new HttpError(409, 'too_late', 'This message has already been sent.');
  }
  await db.update(messages).set({ status: 'draft', isDraft: true, statusAt: new Date(), scheduledAt: null, sentAt: null }).where(eq(messages.id, message.id));
  await recomputeThread(db, message.threadId);
  await publishToUser(c.env, user.id, { type: 'thread.updated', threadId: message.threadId, mailboxId: message.mailboxId });
  return c.json({ draft: await db.select().from(messages).where(eq(messages.id, message.id)).get() });
});

messageRoutes.get('/:id', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireThread(db, user, message.threadId);
  const files = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
  return c.json({
    ...message,
    attachments: files.map((f) => ({ ...f, r2Key: undefined, url: `/api/messages/${message.id}/attachments/${f.id}` })),
  });
});

messageRoutes.patch(
  '/:id',
  requireScope('mail:write'),
  zValidator('json', z.object({ isRead: z.boolean().optional(), isStarred: z.boolean().optional(), trashed: z.boolean().optional() })),
  async (c) => {
    const user = currentUser(c);
    const db = c.var.db;
    const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
    if (!message) throw notFound('Message');
    await requireThread(db, user, message.threadId);
    const body = c.req.valid('json');
    const patch: Partial<typeof messages.$inferInsert> = {};
    if (body.isRead !== undefined) patch.isRead = body.isRead;
    if (body.isStarred !== undefined) patch.isStarred = body.isStarred;
    if (body.trashed !== undefined) patch.trashedAt = body.trashed ? new Date() : null;
    if (Object.keys(patch).length) await db.update(messages).set(patch).where(eq(messages.id, message.id));
    const thread = await recomputeThread(db, message.threadId);
    await publishToUser(c.env, user.id, { type: 'thread.updated', threadId: message.threadId, mailboxId: message.mailboxId });
    return c.json({ message: await db.select().from(messages).where(eq(messages.id, message.id)).get(), thread });
  },
);

messageRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireThread(db, user, message.threadId, 'full_access');
  const permanent = c.req.query('permanent') === '1' || message.isDraft || message.trashedAt !== null;
  if (permanent) {
    await deleteMessageObjects(db, c.env.STORAGE, message);
    await db.delete(messages).where(eq(messages.id, message.id));
  } else {
    await db.update(messages).set({ trashedAt: new Date() }).where(eq(messages.id, message.id));
  }
  const thread = await recomputeThread(db, message.threadId);
  await publishToUser(c.env, user.id, { type: 'thread.updated', threadId: message.threadId, mailboxId: message.mailboxId });
  return c.json({ ok: true, thread });
});

/** Download the original RFC 5322 message ("Show original"). */
messageRoutes.get('/:id/raw', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireThread(db, user, message.threadId);
  const filename = `${(message.subject || 'message').replace(/[^\w.-]+/g, '_').slice(0, 60)}.eml`;
  const headers = {
    'Content-Type': 'message/rfc822',
    'Content-Disposition': contentDisposition(c.req.query('inline') === '1' ? 'inline' : 'attachment', filename),
    'X-Content-Type-Options': 'nosniff',
  };
  if (message.rawR2Key) {
    const object = await c.env.STORAGE.get(message.rawR2Key);
    if (object) return new Response(object.body, { headers });
  }
  const files = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
  const loaded = [];
  for (const f of files) {
    const content = await loadAttachment(c.env.STORAGE, f.r2Key);
    if (content) loaded.push({ filename: f.filename, contentType: f.contentType, content, contentId: f.contentId, disposition: f.disposition });
  }
  const raw = buildMime({
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
    headers: message.headers ?? undefined,
    attachments: loaded,
  });
  return new Response(raw, { headers });
});

const INLINE_SAFE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/|video\/)/;

async function serveAttachment(env: AppEnv, wantsInline: boolean, file: typeof attachments.$inferSelect) {
  const object = await env.STORAGE.get(file.r2Key);
  if (!object) throw notFound('Attachment');
  const inlineOk = wantsInline && INLINE_SAFE.test(file.contentType);
  const contentType = inlineOk ? file.contentType : file.contentType === 'text/html' ? 'text/plain' : file.contentType;
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': contentDisposition(inlineOk ? 'inline' : 'attachment', file.filename),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

messageRoutes.get('/:id/attachments/:attachmentId', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireThread(db, user, message.threadId);
  const file = await db.select().from(attachments).where(and(eq(attachments.id, c.req.param('attachmentId')), eq(attachments.messageId, message.id))).get();
  if (!file) throw notFound('Attachment');
  return serveAttachment(c.env, c.req.query('download') !== '1', file);
});

messageRoutes.get('/:id/cid/:cid', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireThread(db, user, message.threadId);
  const cid = decodeURIComponent(c.req.param('cid')).replace(/^<|>$/g, '');
  const file = await db.select().from(attachments).where(and(eq(attachments.messageId, message.id), eq(attachments.contentId, cid))).get();
  if (!file) throw notFound('Inline image');
  return serveAttachment(c.env, true, file);
});

/** Honour a List-Unsubscribe header (one-click POST, link, or mailto). */
messageRoutes.post('/:id/unsubscribe', requireScope('mail:send'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const message = await db.select().from(messages).where(eq(messages.id, c.req.param('id'))).get();
  if (!message) throw notFound('Message');
  await requireThread(db, user, message.threadId);
  const info = message.listUnsubscribe;
  if (!info) throw badRequest('no_unsubscribe', 'This message has no unsubscribe information.');
  if (info.http && info.oneClick) {
    try {
      const response = await fetch(info.http, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        redirect: 'follow',
      });
      return c.json({ method: 'one_click', ok: response.ok, status: response.status });
    } catch (error) {
      return c.json({ method: 'one_click', ok: false, error: error instanceof Error ? error.message : String(error), url: info.http });
    }
  }
  if (info.mailto) {
    const target = new URL(info.mailto);
    const to = target.pathname;
    const subject = target.searchParams.get('subject') ?? 'unsubscribe';
    const mailbox = await requireMailbox(db, user, message.mailboxId, 'send_as');
    const domain = await db.select().from(domains).where(eq(domains.id, mailbox.domainId)).get();
    if (!domain) throw notFound('Domain');
    const composed = await composeMessage(db, {
      mailbox,
      domain,
      authorUserId: user.id,
      from: { email: mailbox.address, name: mailbox.displayName ?? user.name },
      to: [{ email: normalizeEmail(to), name: null }],
      subject,
      text: target.searchParams.get('body') ?? 'unsubscribe',
      sendMode: 'new',
      bucket: c.env.STORAGE,
    });
    await queueSend(c.env, db, composed, 0);
    return c.json({ method: 'mailto', ok: true });
  }
  return c.json({ method: 'link', ok: true, url: info.http });
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export const draftRoutes = router();
draftRoutes.use('*', requireUser);

draftRoutes.get('/', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const ids = await accessibleMailboxIds(db, user);
  if (!ids.length) return c.json({ items: [] });
  const rows = await db
    .select()
    .from(messages)
    .where(and(inArray(messages.mailboxId, ids), eq(messages.isDraft, true), isNull(messages.trashedAt)))
    .orderBy(desc(messages.updatedAt))
    .limit(200);
  return c.json({ items: rows });
});

draftRoutes.post('/', requireScope('mail:write'), zValidator('json', composeSchema), async (c) => {
  const body = c.req.valid('json');
  const user = currentUser(c);
  const db = c.var.db;
  const { mailbox, domain, from } = await resolveFrom(db, user, body);
  if (body.draftId) {
    const existing = await db.select().from(messages).where(and(eq(messages.id, body.draftId), eq(messages.isDraft, true))).get();
    if (!existing) throw notFound('Draft');
    await requireMailbox(db, user, existing.mailboxId, 'send_as');
  }
  const message = await composeMessage(db, {
    mailbox,
    domain,
    authorUserId: user.id,
    from,
    to: body.to.map((a) => ({ email: normalizeEmail(a.email), name: a.name ?? null })).filter((a) => a.email),
    cc: body.cc.map((a) => ({ email: normalizeEmail(a.email), name: a.name ?? null })).filter((a) => a.email),
    bcc: body.bcc.map((a) => ({ email: normalizeEmail(a.email), name: a.name ?? null })).filter((a) => a.email),
    subject: body.subject,
    html: body.html ?? null,
    text: body.text ?? (body.html ? htmlToText(body.html) : null),
    uploadIds: body.uploadIds,
    replyToMessageId: body.replyToMessageId ?? null,
    forwardOfMessageId: body.forwardOfMessageId ?? null,
    sendMode: body.sendMode,
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
    draft: true,
    existingDraftId: body.draftId ?? null,
    bucket: c.env.STORAGE,
  });
  return c.json({ draft: message });
});

draftRoutes.delete('/:id', requireScope('mail:write'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const draft = await db.select().from(messages).where(and(eq(messages.id, c.req.param('id')), eq(messages.isDraft, true))).get();
  if (!draft) throw notFound('Draft');
  await requireMailbox(db, user, draft.mailboxId, 'send_as');
  await deleteMessageObjects(db, c.env.STORAGE, draft);
  await db.delete(messages).where(eq(messages.id, draft.id));
  await recomputeThread(db, draft.threadId);
  await publishToUser(c.env, user.id, { type: 'thread.updated', threadId: draft.threadId, mailboxId: draft.mailboxId });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Uploads (staged attachments for the composer)
// ---------------------------------------------------------------------------

export const uploadRoutes = router();
uploadRoutes.use('*', requireUser);

uploadRoutes.post('/', requireScope('mail:send'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const settings = await getSettings(db);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('file_required', 'Send the file as multipart/form-data under "file".');
  if (file.size > settings.maxAttachmentBytes) {
    throw badRequest('too_large', `Attachments are limited to ${(settings.maxAttachmentBytes / 1024 / 1024).toFixed(0)} MB each.`);
  }
  const id = newId();
  const filename = file.name || 'attachment';
  const key = uploadKey(user.id, id, filename);
  const contentType = file.type || 'application/octet-stream';
  await c.env.STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType }, customMetadata: { filename: filename.slice(0, 500) } });
  await db.insert(attachments).values({
    id,
    messageId: null,
    uploadedByUserId: user.id,
    filename: filename.slice(0, 500),
    contentType,
    sizeBytes: file.size,
    disposition: form.get('inline') === '1' ? 'inline' : 'attachment',
    contentId: form.get('inline') === '1' ? id : null,
    r2Key: key,
  });
  return c.json({ id, filename, contentType, sizeBytes: file.size, contentId: form.get('inline') === '1' ? id : null, url: `/api/uploads/${id}` });
});

uploadRoutes.get('/:id', requireScope('mail:read'), async (c) => {
  const user = currentUser(c);
  const row = await c.var.db.select().from(attachments).where(and(eq(attachments.id, c.req.param('id')), eq(attachments.uploadedByUserId, user.id))).get();
  if (!row) throw notFound('Upload');
  const object = await c.env.STORAGE.get(row.r2Key);
  if (!object) throw notFound('Upload');
  return new Response(object.body, {
    headers: {
      'Content-Type': INLINE_SAFE.test(row.contentType) ? row.contentType : 'application/octet-stream',
      'Content-Disposition': contentDisposition(INLINE_SAFE.test(row.contentType) ? 'inline' : 'attachment', row.filename),
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

uploadRoutes.delete('/:id', requireScope('mail:send'), async (c) => {
  const user = currentUser(c);
  const db = c.var.db;
  const row = await db.select().from(attachments).where(and(eq(attachments.id, c.req.param('id')), eq(attachments.uploadedByUserId, user.id), isNull(attachments.messageId))).get();
  if (!row) throw notFound('Upload');
  await c.env.STORAGE.delete(row.r2Key).catch(() => undefined);
  await db.delete(attachments).where(eq(attachments.id, row.id));
  return c.json({ ok: true });
});
