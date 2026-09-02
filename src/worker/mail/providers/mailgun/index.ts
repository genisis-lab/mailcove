import { formatAddress } from '../../../../shared/address';
import type { DnsRecord } from '../../../../shared/types';
import { hexEncode, hmacSha256, timingSafeEqual } from '../../../lib/crypto';
import {
  ProviderError,
  type DeliveryEvent,
  type DeliveryEventType,
  type InboundEvent,
  type MailProvider,
  type OutboundMessage,
  type ProviderCapabilities,
  type ProviderDomainInfo,
  type SendResult,
  type WebhookResult,
} from '../types';

export const MAILGUN_CAPABILITIES: ProviderCapabilities = {
  kind: 'mailgun',
  label: 'Mailgun',
  description: 'Send via the Mailgun Messages API; receive through a Mailgun route that stores the message and notifies Mailcove.',
  maxMessageBytes: 25 * 1024 * 1024,
  maxAttachments: 50,
  maxRecipients: 1000,
  deliveryEvents: true,
  inbound: 'webhook',
  domainManagement: true,
  requiresCloudflareDns: false,
  webhookPath: '/api/webhooks/mailgun',
  docsUrl: 'https://documentation.mailgun.com/',
  credentialFields: [
    { name: 'MAILGUN_API_KEY', label: 'Private API key', secret: true, required: true },
    { name: 'MAILGUN_WEBHOOK_SIGNING_KEY', label: 'HTTP webhook signing key', secret: true, required: true, hint: 'Settings → API security → HTTP webhook signing key.' },
    { name: 'MAILGUN_REGION', label: 'Region', secret: false, required: false, hint: '"us" (default) or "eu".' },
  ],
};

type Credentials = { MAILGUN_API_KEY?: string; MAILGUN_WEBHOOK_SIGNING_KEY?: string; MAILGUN_REGION?: string };

type MgDomainResponse = {
  domain: { name: string; state: string; type?: string };
  sending_dns_records?: Array<{ record_type: string; name: string; value: string; valid?: string; priority?: string }>;
  receiving_dns_records?: Array<{ record_type: string; name?: string; value: string; valid?: string; priority?: string }>;
};

export function createMailgunProvider(credentials: Credentials): MailProvider {
  const apiKey = credentials.MAILGUN_API_KEY;
  const region = (credentials.MAILGUN_REGION ?? 'us').toLowerCase() === 'eu' ? 'eu' : 'us';
  const API = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!apiKey) throw new ProviderError(400, 'mailgun_api_key_missing', 'MAILGUN_API_KEY is not configured.');
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}`, ...(init.headers as Record<string, string>) },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const message = (body as { message?: string } | null)?.message ?? `Mailgun request failed (${response.status})`;
      const retryable = response.status >= 500 || response.status === 429;
      throw new ProviderError(retryable ? 502 : 400, `mailgun_http_${response.status}`, message, retryable);
    }
    return body as T;
  }

  return {
    kind: 'mailgun',
    capabilities: MAILGUN_CAPABILITIES,
    isConfigured: () => Boolean(apiKey),

    async send(message: OutboundMessage): Promise<SendResult> {
      const form = new FormData();
      form.set('from', formatAddress(message.from));
      for (const a of message.to) form.append('to', formatAddress(a));
      for (const a of message.cc) form.append('cc', formatAddress(a));
      for (const a of message.bcc) form.append('bcc', formatAddress(a));
      if (message.replyTo) form.set('h:Reply-To', formatAddress(message.replyTo));
      form.set('subject', message.subject);
      if (message.text) form.set('text', message.text);
      if (message.html) form.set('html', message.html);
      for (const [key, value] of Object.entries(message.headers)) form.set(`h:${key}`, value);
      form.set('v:mailcove_key', message.idempotencyKey);
      for (const a of message.attachments) {
        const blob = new Blob([a.content as unknown as ArrayBuffer], { type: a.contentType });
        form.append(a.disposition === 'inline' ? 'inline' : 'attachment', blob, a.filename);
      }
      const domain = message.from.email.split('@')[1] ?? '';
      const result = await request<{ id?: string; message?: string }>(`/v3/${encodeURIComponent(domain)}/messages`, { method: 'POST', body: form });
      const id = result.id ?? message.idempotencyKey;
      return { providerMessageId: id.replace(/^<|>$/g, ''), status: 'queued', messageIdHeader: id };
    },

    async createDomain(name, context) {
      let domain: MgDomainResponse;
      try {
        domain = await request<MgDomainResponse>(`/v4/domains/${encodeURIComponent(name)}`);
      } catch {
        const form = new FormData();
        form.set('name', name);
        form.set('web_scheme', 'https');
        domain = await request<MgDomainResponse>('/v4/domains', { method: 'POST', body: form });
      }
      const notifyUrl = `${context.appBaseUrl}${MAILGUN_CAPABILITIES.webhookPath}`;
      try {
        const routes = await request<{ items: Array<{ id: string; expression: string }> }>('/v3/routes?limit=500');
        const expression = `match_recipient(".*@${name.replace(/\./g, '\\.')}")`;
        if (!routes.items.some((r) => r.expression === expression)) {
          const form = new FormData();
          form.set('priority', '0');
          form.set('description', 'Mailcove inbox');
          form.set('expression', expression);
          form.append('action', `store(notify="${notifyUrl}")`);
          form.append('action', 'stop()');
          await request('/v3/routes', { method: 'POST', body: form });
        }
      } catch (error) {
        console.warn('mailgun route setup failed', error);
      }
      for (const id of ['delivered', 'permanent_fail', 'temporary_fail', 'complained', 'opened', 'clicked', 'unsubscribed']) {
        try {
          const form = new FormData();
          form.set('id', id);
          form.set('url', notifyUrl);
          await request(`/v3/domains/${encodeURIComponent(name)}/webhooks`, { method: 'POST', body: form });
        } catch {
          // already exists or unsupported on this plan
        }
      }
      return toDomainInfo(domain, context.appBaseUrl);
    },

    async getDomain(name, _providerDomainId, context) {
      return toDomainInfo(await request<MgDomainResponse>(`/v4/domains/${encodeURIComponent(name)}`), context.appBaseUrl);
    },

    async verifyDomain(name, _providerDomainId, context) {
      try {
        await request(`/v4/domains/${encodeURIComponent(name)}/verify`, { method: 'PUT' });
      } catch (error) {
        console.warn('mailgun verify failed', error);
      }
      return toDomainInfo(await request<MgDomainResponse>(`/v4/domains/${encodeURIComponent(name)}`), context.appBaseUrl);
    },

    async deleteDomain(name) {
      await request(`/v3/domains/${encodeURIComponent(name)}`, { method: 'DELETE' });
    },

    async handleWebhook(request: Request): Promise<WebhookResult> {
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = (await request.json()) as { signature?: MgSignature; 'event-data'?: Record<string, unknown> };
        await verifySignature(payload.signature, credentials.MAILGUN_WEBHOOK_SIGNING_KEY);
        const data = payload['event-data'] ?? {};
        const type = mapEvent(String(data.event ?? ''), data);
        if (!type) return { events: [] };
        const headers = (data.message as { headers?: Record<string, string> } | undefined)?.headers ?? {};
        const messageId = String(headers['message-id'] ?? '').replace(/^<|>$/g, '');
        const event: DeliveryEvent = {
          kind: 'delivery',
          provider: 'mailgun',
          eventId: `mailgun:${String(data.id ?? `${messageId}:${data.event}:${data.timestamp}`)}`,
          providerMessageId: messageId,
          type,
          recipient: String(data.recipient ?? '') || null,
          detail: { event: data.event, severity: data.severity, reason: data.reason, deliveryStatus: data['delivery-status'] },
          occurredAt: data.timestamp ? new Date(Number(data.timestamp) * 1000) : new Date(),
        };
        return { events: [event] };
      }

      // Route "store(notify=...)" posts multipart/form-data.
      const form = await request.formData();
      await verifySignature(
        { timestamp: String(form.get('timestamp') ?? ''), token: String(form.get('token') ?? ''), signature: String(form.get('signature') ?? '') },
        credentials.MAILGUN_WEBHOOK_SIGNING_KEY,
      );
      const messageUrl = String(form.get('message-url') ?? '');
      const messageId = String(form.get('Message-Id') ?? '').replace(/^<|>$/g, '');
      const event: InboundEvent = {
        kind: 'inbound',
        provider: 'mailgun',
        eventId: `mailgun:${String(form.get('token') ?? messageId)}`,
        providerMessageId: messageId || String(form.get('token') ?? ''),
        envelopeFrom: String(form.get('sender') ?? form.get('from') ?? ''),
        envelopeTo: String(form.get('recipient') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        fetchRef: messageUrl,
      };
      return { events: [event] };
    },

    async fetchInbound(fetchRef: string) {
      if (!apiKey) throw new ProviderError(400, 'mailgun_api_key_missing', 'MAILGUN_API_KEY is not configured.');
      const response = await fetch(fetchRef, {
        headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}`, Accept: 'message/rfc822' },
      });
      if (!response.ok) throw new ProviderError(502, 'mailgun_fetch_failed', `Could not fetch stored message (${response.status})`, response.status >= 500);
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = (await response.json()) as { 'body-mime'?: string };
        if (body['body-mime']) return { raw: new TextEncoder().encode(body['body-mime']) };
        throw new ProviderError(502, 'mailgun_fetch_failed', 'Stored message did not include MIME content', false);
      }
      return { raw: new Uint8Array(await response.arrayBuffer()) };
    },
  };
}

type MgSignature = { timestamp?: string; token?: string; signature?: string };

async function verifySignature(sig: MgSignature | undefined, signingKey: string | undefined): Promise<void> {
  if (!signingKey) throw new ProviderError(401, 'mailgun_signing_key_missing', 'MAILGUN_WEBHOOK_SIGNING_KEY is not configured.');
  if (!sig?.timestamp || !sig.token || !sig.signature) throw new ProviderError(401, 'mailgun_signature_missing', 'Missing Mailgun signature');
  const skew = Math.abs(Date.now() / 1000 - Number(sig.timestamp));
  if (!Number.isFinite(skew) || skew > 300) throw new ProviderError(401, 'mailgun_signature_stale', 'Mailgun signature timestamp out of range');
  const expected = hexEncode(await hmacSha256(signingKey, `${sig.timestamp}${sig.token}`));
  if (!timingSafeEqual(expected, sig.signature.toLowerCase())) throw new ProviderError(401, 'mailgun_signature_invalid', 'Mailgun signature mismatch');
}

function mapEvent(event: string, data: Record<string, unknown>): DeliveryEventType | null {
  switch (event) {
    case 'accepted':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'failed':
      return String(data.severity ?? '') === 'temporary' ? 'delayed' : 'bounced';
    case 'rejected':
      return 'failed';
    case 'complained':
      return 'complained';
    case 'opened':
      return 'opened';
    case 'clicked':
      return 'clicked';
    case 'unsubscribed':
      return 'unsubscribed';
    default:
      return null;
  }
}

function toDomainInfo(domain: MgDomainResponse, appBaseUrl: string): ProviderDomainInfo {
  const records: DnsRecord[] = [];
  for (const r of domain.sending_dns_records ?? []) {
    records.push({ type: r.record_type.toUpperCase(), name: r.name, value: r.value, status: r.valid === 'valid' ? 'verified' : 'pending', purpose: 'Sending' });
  }
  for (const r of domain.receiving_dns_records ?? []) {
    records.push({
      type: r.record_type.toUpperCase(),
      name: r.name ?? domain.domain.name,
      value: r.value,
      priority: r.priority ? Number(r.priority) : null,
      status: r.valid === 'valid' ? 'verified' : 'pending',
      purpose: 'Receiving',
    });
  }
  const active = domain.domain.state === 'active';
  const receiving = (domain.receiving_dns_records ?? []).length > 0 && (domain.receiving_dns_records ?? []).every((r) => r.valid === 'valid');
  return {
    providerDomainId: domain.domain.name,
    name: domain.domain.name,
    status: active ? 'verified' : 'pending',
    sendingEnabled: active,
    receivingEnabled: receiving,
    records,
    notes: [`Inbound route and event webhooks point at ${appBaseUrl}${MAILGUN_CAPABILITIES.webhookPath}.`],
  };
}