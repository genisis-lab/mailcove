import { parseAddressList, parseSingleAddress } from '../../../../shared/address';
import type { DnsRecord } from '../../../../shared/types';
import { base64Decode, base64Encode, sha256Hex, timingSafeEqual } from '../../../lib/crypto';
import {
  ProviderError,
  type DeliveryEvent,
  type DeliveryEventType,
  type InboundEvent,
  type MailProvider,
  type OutboundMessage,
  type ParsedMail,
  type ProviderCapabilities,
  type ProviderDomainInfo,
  type SendResult,
  type WebhookResult,
} from '../types';

const API = 'https://api.sendgrid.com/v3';

export const SENDGRID_CAPABILITIES: ProviderCapabilities = {
  kind: 'sendgrid',
  label: 'SendGrid',
  description: 'Send through the SendGrid v3 API; receive via the Inbound Parse webhook; delivery status via the Event Webhook.',
  maxMessageBytes: 30 * 1024 * 1024,
  maxAttachments: 50,
  maxRecipients: 1000,
  deliveryEvents: true,
  inbound: 'webhook',
  domainManagement: true,
  requiresCloudflareDns: false,
  webhookPath: '/api/webhooks/sendgrid',
  docsUrl: 'https://www.twilio.com/docs/sendgrid',
  credentialFields: [
    { name: 'SENDGRID_API_KEY', label: 'API key', secret: true, required: true, hint: 'Full access or Mail Send + Sender Authentication + Inbound Parse.' },
    {
      name: 'SENDGRID_WEBHOOK_PUBLIC_KEY',
      label: 'Event Webhook verification key',
      secret: false,
      required: false,
      hint: 'Enable Signed Event Webhook in SendGrid and paste the public key.',
    },
    {
      name: 'SENDGRID_INBOUND_TOKEN',
      label: 'Inbound Parse token',
      secret: true,
      required: false,
      hint: 'Mailcove appends ?token=<value> to the Inbound Parse URL because SendGrid does not sign inbound posts.',
    },
  ],
};

type Credentials = { SENDGRID_API_KEY?: string; SENDGRID_WEBHOOK_PUBLIC_KEY?: string; SENDGRID_INBOUND_TOKEN?: string };

type SgDomain = {
  id: number;
  domain: string;
  subdomain?: string;
  valid: boolean;
  dns: Record<string, { host: string; type: string; data: string; valid: boolean }>;
};

export function createSendgridProvider(credentials: Credentials): MailProvider {
  const apiKey = credentials.SENDGRID_API_KEY;

  async function request<T>(path: string, init: RequestInit = {}): Promise<{ body: T; headers: Headers }> {
    if (!apiKey) throw new ProviderError(400, 'sendgrid_api_key_missing', 'SENDGRID_API_KEY is not configured.');
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const errors = (body as { errors?: Array<{ message: string }> } | null)?.errors;
      const retryable = response.status >= 500 || response.status === 429;
      throw new ProviderError(retryable ? 502 : 400, `sendgrid_http_${response.status}`, errors?.[0]?.message ?? `SendGrid request failed (${response.status})`, retryable);
    }
    return { body: body as T, headers: response.headers };
  }

  return {
    kind: 'sendgrid',
    capabilities: SENDGRID_CAPABILITIES,
    isConfigured: () => Boolean(apiKey),

    async send(message: OutboundMessage): Promise<SendResult> {
      const content = [];
      if (message.text) content.push({ type: 'text/plain', value: message.text });
      if (message.html) content.push({ type: 'text/html', value: message.html });
      if (!content.length) content.push({ type: 'text/plain', value: ' ' });
      const { headers } = await request<unknown>('/mail/send', {
        method: 'POST',
        body: JSON.stringify({
          personalizations: [
            {
              to: message.to.map(sgAddress),
              ...(message.cc.length ? { cc: message.cc.map(sgAddress) } : {}),
              ...(message.bcc.length ? { bcc: message.bcc.map(sgAddress) } : {}),
            },
          ],
          from: sgAddress(message.from),
          ...(message.replyTo ? { reply_to: sgAddress(message.replyTo) } : {}),
          subject: message.subject,
          content,
          ...(Object.keys(message.headers).length ? { headers: message.headers } : {}),
          ...(message.attachments.length
            ? {
                attachments: message.attachments.map((a) => ({
                  content: base64Encode(a.content),
                  type: a.contentType,
                  filename: a.filename,
                  disposition: a.disposition,
                  ...(a.contentId ? { content_id: a.contentId } : {}),
                })),
              }
            : {}),
          custom_args: { mailcove_key: message.idempotencyKey },
        }),
      });
      const id = headers.get('x-message-id') ?? message.idempotencyKey;
      return { providerMessageId: id, status: 'queued', messageIdHeader: null };
    },

    async createDomain(name, context) {
      const existing = await findDomain(name);
      const domain = existing ?? (await request<SgDomain>('/whitelabel/domains', { method: 'POST', body: JSON.stringify({ domain: name, automatic_security: true }) })).body;
      try {
        await request('/user/webhooks/parse/settings', {
          method: 'POST',
          body: JSON.stringify({ hostname: name, url: inboundUrl(context.appBaseUrl, credentials), spam_check: false, send_raw: true }),
        });
      } catch (error) {
        console.warn('sendgrid inbound parse setup failed', error);
      }
      return toDomainInfo(domain, context.appBaseUrl);
    },

    async getDomain(name, providerDomainId, context) {
      const id = providerDomainId ?? (await findDomain(name))?.id;
      if (!id) throw new ProviderError(404, 'sendgrid_domain_not_found', `${name} is not authenticated in SendGrid yet.`);
      return toDomainInfo((await request<SgDomain>(`/whitelabel/domains/${id}`)).body, context.appBaseUrl);
    },

    async verifyDomain(name, providerDomainId, context) {
      const id = providerDomainId ?? (await findDomain(name))?.id;
      if (!id) throw new ProviderError(404, 'sendgrid_domain_not_found', `${name} is not authenticated in SendGrid yet.`);
      try {
        await request(`/whitelabel/domains/${id}/validate`, { method: 'POST', body: '{}' });
      } catch (error) {
        console.warn('sendgrid validate failed', error);
      }
      return toDomainInfo((await request<SgDomain>(`/whitelabel/domains/${id}`)).body, context.appBaseUrl);
    },

    async deleteDomain(name, providerDomainId) {
      if (providerDomainId) await request(`/whitelabel/domains/${providerDomainId}`, { method: 'DELETE' });
      try {
        await request(`/user/webhooks/parse/settings/${encodeURIComponent(name)}`, { method: 'DELETE' });
      } catch {
        // parse setting may not exist
      }
    },

    async handleWebhook(request: Request): Promise<WebhookResult> {
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.includes('multipart/form-data')) {
        return handleInboundParse(request, credentials);
      }
      return handleEventWebhook(request, credentials);
    },
  };

  async function findDomain(name: string): Promise<SgDomain | null> {
    const { body } = await request<SgDomain[]>(`/whitelabel/domains?domain=${encodeURIComponent(name)}&limit=50`);
    return body.find((d) => d.domain.toLowerCase() === name.toLowerCase() && !d.subdomain) ?? body.find((d) => d.domain.toLowerCase() === name.toLowerCase()) ?? null;
  }
}

function sgAddress(a: { email: string; name?: string | null }) {
  return a.name ? { email: a.email, name: a.name } : { email: a.email };
}

function inboundUrl(appBaseUrl: string, credentials: Credentials): string {
  const url = `${appBaseUrl}${SENDGRID_CAPABILITIES.webhookPath}`;
  return credentials.SENDGRID_INBOUND_TOKEN ? `${url}?token=${encodeURIComponent(credentials.SENDGRID_INBOUND_TOKEN)}` : url;
}

async function handleInboundParse(request: Request, credentials: Credentials): Promise<WebhookResult> {
  if (credentials.SENDGRID_INBOUND_TOKEN) {
    const token = new URL(request.url).searchParams.get('token') ?? '';
    if (!timingSafeEqual(token, credentials.SENDGRID_INBOUND_TOKEN)) {
      throw new ProviderError(401, 'sendgrid_inbound_unauthorized', 'Inbound Parse token mismatch');
    }
  }
  const form = await request.formData();
  const envelope = safeJson<{ from?: string; to?: string[] }>(form.get('envelope')) ?? {};
  const rawEmail = form.get('email');
  const eventId = `sendgrid:${await sha256Hex(`${envelope.from ?? ''}|${(envelope.to ?? []).join(',')}|${form.get('subject') ?? ''}|${Date.now()}`)}`;

  if (typeof rawEmail === 'string' && rawEmail.length > 0) {
    const raw = new TextEncoder().encode(rawEmail);
    const event: InboundEvent = {
      kind: 'inbound',
      provider: 'sendgrid',
      eventId,
      providerMessageId: eventId,
      envelopeFrom: envelope.from ?? '',
      envelopeTo: envelope.to ?? [],
      raw,
    };
    return { events: [event] };
  }
  if (rawEmail instanceof File) {
    const raw = new Uint8Array(await rawEmail.arrayBuffer());
    const event: InboundEvent = { kind: 'inbound', provider: 'sendgrid', eventId, providerMessageId: eventId, envelopeFrom: envelope.from ?? '', envelopeTo: envelope.to ?? [], raw };
    return { events: [event] };
  }

  // Parsed (non-raw) mode: rebuild a ParsedMail from the individual fields.
  const headersText = String(form.get('headers') ?? '');
  const headers: Record<string, string> = {};
  for (const line of headersText.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  const attachments: ParsedMail['attachments'] = [];
  const info = safeJson<Record<string, { filename?: string; type?: string; 'content-id'?: string }>>(form.get('attachment-info')) ?? {};
  for (const [field, meta] of Object.entries(info)) {
    const file = form.get(field);
    if (file instanceof File) {
      attachments.push({
        filename: meta.filename || file.name || 'attachment',
        contentType: meta.type || file.type || 'application/octet-stream',
        content: new Uint8Array(await file.arrayBuffer()),
        disposition: meta['content-id'] ? 'inline' : 'attachment',
        contentId: meta['content-id'] ?? null,
      });
    }
  }
  const from = parseSingleAddress(String(form.get('from') ?? '')) ?? { email: envelope.from ?? '', name: null };
  const text = (form.get('text') as string | null) ?? null;
  const html = (form.get('html') as string | null) ?? null;
  const parsed: ParsedMail = {
    messageId: headers['message-id'] ?? null,
    inReplyTo: headers['in-reply-to'] ?? null,
    references: headers['references'] ?? null,
    from,
    to: parseAddressList(String(form.get('to') ?? '')),
    cc: parseAddressList(String(form.get('cc') ?? '')),
    bcc: [],
    replyTo: parseAddressList(headers['reply-to']),
    subject: String(form.get('subject') ?? ''),
    date: headers['date'] ? new Date(headers['date']) : null,
    text,
    html,
    headers,
    attachments,
    sizeBytes: (text?.length ?? 0) + (html?.length ?? 0) + attachments.reduce((n, a) => n + a.content.byteLength, 0),
  };
  const event: InboundEvent = {
    kind: 'inbound',
    provider: 'sendgrid',
    eventId,
    providerMessageId: parsed.messageId ?? eventId,
    envelopeFrom: envelope.from ?? from.email,
    envelopeTo: envelope.to ?? parsed.to.map((t) => t.email),
    parsed,
  };
  return { events: [event] };
}

async function handleEventWebhook(request: Request, credentials: Credentials): Promise<WebhookResult> {
  const rawBody = await request.text();
  if (credentials.SENDGRID_WEBHOOK_PUBLIC_KEY) {
    const signature = request.headers.get('x-twilio-email-event-webhook-signature');
    const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp');
    if (!signature || !timestamp) throw new ProviderError(401, 'sendgrid_signature_missing', 'Missing Event Webhook signature headers');
    const ok = await verifyEcdsa(credentials.SENDGRID_WEBHOOK_PUBLIC_KEY, signature, timestamp + rawBody);
    if (!ok) throw new ProviderError(401, 'sendgrid_signature_invalid', 'Event Webhook signature mismatch');
  }
  const items = JSON.parse(rawBody) as Array<Record<string, unknown>>;
  const events: DeliveryEvent[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const type = mapEvent(String(item.event ?? ''));
    if (!type) continue;
    const sgId = String(item.sg_message_id ?? '');
    const providerMessageId = sgId.split('.')[0] ?? sgId;
    const key = String(item.sg_event_id ?? `${sgId}:${item.event}:${item.timestamp}`);
    events.push({
      kind: 'delivery',
      provider: 'sendgrid',
      eventId: `sendgrid:${key}`,
      providerMessageId,
      type,
      recipient: String(item.email ?? '') || null,
      detail: { event: item.event, reason: item.reason, status: item.status, type: item.type, response: item.response },
      occurredAt: item.timestamp ? new Date(Number(item.timestamp) * 1000) : new Date(),
    });
  }
  return { events };
}

function mapEvent(event: string): DeliveryEventType | null {
  switch (event) {
    case 'processed':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'deferred':
      return 'delayed';
    case 'bounce':
      return 'bounced';
    case 'dropped':
      return 'failed';
    case 'spamreport':
      return 'complained';
    case 'open':
      return 'opened';
    case 'click':
      return 'clicked';
    case 'unsubscribe':
    case 'group_unsubscribe':
      return 'unsubscribed';
    default:
      return null;
  }
}

async function verifyEcdsa(publicKeyB64: string, signatureB64: string, payload: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', base64Decode(publicKeyB64) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signature = derToRaw(base64Decode(signatureB64));
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as BufferSource, new TextEncoder().encode(payload));
  } catch (error) {
    console.warn('sendgrid ecdsa verify error', error);
    return false;
  }
}

/** DER (ASN.1 SEQUENCE of two INTEGERs) → IEEE P1363 r||s as WebCrypto expects. */
function derToRaw(der: Uint8Array): Uint8Array {
  let offset = 2;
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;
  const readInt = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error('bad DER');
    const len = der[offset + 1]!;
    let value = der.slice(offset + 2, offset + 2 + len);
    offset += 2 + len;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

function safeJson<T>(value: string | File | null): T | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toDomainInfo(domain: SgDomain, appBaseUrl: string): ProviderDomainInfo {
  const records: DnsRecord[] = Object.entries(domain.dns ?? {}).map(([key, r]) => ({
    type: r.type.toUpperCase(),
    name: r.host,
    value: r.data,
    status: r.valid ? 'verified' : 'pending',
    purpose: key.startsWith('dkim') ? 'DKIM' : key === 'mail_cname' ? 'Return-Path' : key,
  }));
  records.push({ type: 'MX', name: domain.domain, value: 'mx.sendgrid.net', priority: 10, status: 'unknown', purpose: 'Inbound Parse' });
  return {
    providerDomainId: String(domain.id),
    name: domain.domain,
    status: domain.valid ? 'verified' : 'pending',
    sendingEnabled: domain.valid,
    receivingEnabled: true,
    records,
    notes: [
      `Inbound Parse posts to ${appBaseUrl}${SENDGRID_CAPABILITIES.webhookPath}. Configure the Event Webhook with the same URL (enable signing) for delivery status.`,
    ],
  };
}
