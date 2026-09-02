import PostalMime, { type Address as PmAddress } from 'postal-mime';
import { normalizeEmail } from '../../shared/address';
import type { Address } from '../../shared/types';
import type { ParsedMail } from './providers/types';

const INTERESTING_HEADERS = new Set([
  'message-id',
  'in-reply-to',
  'references',
  'date',
  'list-id',
  'list-unsubscribe',
  'list-unsubscribe-post',
  'precedence',
  'auto-submitted',
  'x-auto-response-suppress',
  'x-autoreply',
  'x-autorespond',
  'authentication-results',
  'received-spf',
  'dkim-signature',
  'arc-authentication-results',
  'x-spam-status',
  'x-spam-flag',
  'x-mailcove-forwarded',
  'x-priority',
  'importance',
  'reply-to',
  'return-path',
  'delivered-to',
  'x-original-to',
  'content-language',
  'x-mailer',
  'user-agent',
]);

/** Parses raw RFC 5322 bytes into the provider-neutral shape used by the ingest pipeline. */
export async function parseRawMail(raw: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>): Promise<ParsedMail> {
  const bytes = raw instanceof ReadableStream ? new Uint8Array(await new Response(raw).arrayBuffer()) : raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
  const email = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer', rfc822Attachments: true });

  const headers: Record<string, string> = {};
  for (const h of email.headers) {
    if (INTERESTING_HEADERS.has(h.key) && !(h.key in headers)) headers[h.key] = h.value;
  }

  const attachments: ParsedMail['attachments'] = email.attachments.map((a) => ({
    filename: a.filename || defaultFilename(a.mimeType),
    contentType: a.mimeType || 'application/octet-stream',
    content: toBytes(a.content),
    disposition: a.disposition === 'inline' || a.related ? 'inline' : 'attachment',
    contentId: a.contentId?.replace(/^<|>$/g, '') ?? null,
  }));

  const from = flatten(email.from ? [email.from] : [])[0] ?? { email: normalizeEmail(email.returnPath ?? ''), name: null };

  return {
    messageId: email.messageId ?? null,
    inReplyTo: email.inReplyTo ?? null,
    references: email.references ?? null,
    from,
    to: flatten(email.to),
    cc: flatten(email.cc),
    bcc: flatten(email.bcc),
    replyTo: flatten(email.replyTo),
    subject: email.subject ?? '',
    date: email.date ? safeDate(email.date) : null,
    text: email.text ?? null,
    html: email.html ?? null,
    headers,
    attachments,
    sizeBytes: bytes.byteLength,
  };
}

function flatten(list: PmAddress[] | undefined): Address[] {
  const out: Address[] = [];
  for (const entry of list ?? []) {
    if (entry.group) {
      for (const member of entry.group) if (member.address) out.push({ email: normalizeEmail(member.address), name: member.name || null });
    } else if (entry.address) {
      out.push({ email: normalizeEmail(entry.address), name: entry.name || null });
    }
  }
  return out;
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function safeDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultFilename(mimeType: string): string {
  const ext = mimeType.split('/')[1]?.split(';')[0]?.trim();
  return ext ? `attachment.${ext}` : 'attachment';
}
