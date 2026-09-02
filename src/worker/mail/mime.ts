import { formatAddress } from '../../shared/address';
import type { Address } from '../../shared/types';
import { base64Encode } from '../lib/crypto';

export type MimeInput = {
  from: Address;
  to: Address[];
  cc?: Address[];
  subject: string;
  date: Date;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; contentType: string; content: Uint8Array; contentId?: string | null; disposition?: 'inline' | 'attachment' }>;
};

function encodeHeaderValue(value: string): string {
  // RFC 2047 encoded-word for non-ASCII header text.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64Encode(new TextEncoder().encode(value))}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function qp(text: string): string {
  // quoted-printable (simplified, sufficient for archival/raw download)
  const bytes = new TextEncoder().encode(text.replace(/\r?\n/g, '\r\n'));
  let out = '';
  let lineLen = 0;
  for (const b of bytes) {
    let token: string;
    if (b === 13 || b === 10) {
      out += String.fromCharCode(b);
      lineLen = 0;
      continue;
    }
    if ((b >= 33 && b <= 126 && b !== 61) || b === 32) token = String.fromCharCode(b);
    else token = `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
    if (lineLen + token.length > 74) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += token;
    lineLen += token.length;
  }
  return out;
}

/** Builds an RFC 5322 message for archival ("show original") of messages we composed. */
export function buildMime(input: MimeInput): string {
  const boundaryMixed = `----=_mailcove_mixed_${crypto.randomUUID()}`;
  const boundaryAlt = `----=_mailcove_alt_${crypto.randomUUID()}`;
  const lines: string[] = [];
  lines.push(`From: ${encodeAddress(input.from)}`);
  if (input.to.length) lines.push(`To: ${input.to.map(encodeAddress).join(', ')}`);
  if (input.cc?.length) lines.push(`Cc: ${input.cc.map(encodeAddress).join(', ')}`);
  lines.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  lines.push(`Date: ${input.date.toUTCString()}`);
  if (input.messageId) lines.push(`Message-ID: ${input.messageId}`);
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);
  for (const [k, v] of Object.entries(input.headers ?? {})) lines.push(`${k}: ${encodeHeaderValue(v)}`);
  lines.push('MIME-Version: 1.0');

  const bodyParts: string[] = [];
  const altParts: string[] = [];
  if (input.text) altParts.push(`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(input.text)}`);
  if (input.html) altParts.push(`Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(input.html)}`);
  let bodySection: string;
  if (altParts.length > 1) {
    bodySection = `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n` + altParts.map((p) => `--${boundaryAlt}\r\n${p}\r\n`).join('') + `--${boundaryAlt}--\r\n`;
  } else {
    bodySection = altParts[0] ?? 'Content-Type: text/plain; charset=UTF-8\r\n\r\n';
  }

  const files = input.attachments ?? [];
  if (files.length === 0) {
    lines.push(bodySection);
    return lines.join('\r\n');
  }
  lines.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
  lines.push('');
  bodyParts.push(`--${boundaryMixed}\r\n${bodySection}`);
  for (const f of files) {
    const name = encodeHeaderValue(f.filename);
    bodyParts.push(
      `--${boundaryMixed}\r\nContent-Type: ${f.contentType}; name="${name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: ${f.disposition ?? 'attachment'}; filename="${name}"\r\n${f.contentId ? `Content-ID: <${f.contentId}>\r\n` : ''}\r\n${wrap76(base64Encode(f.content))}\r\n`,
    );
  }
  bodyParts.push(`--${boundaryMixed}--\r\n`);
  return lines.join('\r\n') + bodyParts.join('');
}

function encodeAddress(a: Address): string {
  if (!a.name) return a.email;
  return formatAddress({ email: a.email, name: encodeHeaderValue(a.name) });
}
