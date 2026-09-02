import { formatAddress, parseAddressList, parseSingleAddress } from '../../../../shared/address';
import type { DnsRecord } from '../../../../shared/types';
import { base64Encode } from '../../../lib/crypto';
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
import { RESEND_WEBHOOK_EVENTS, ResendClient, type ResendDomain, type ResendReceivedEmail } from './client';
import { verifySvixSignature } from './webhook-signature';

export const RESEND_CAPABILITIES: ProviderCapabilities = {
  kind: 'resend',
  label: 'Resend',
  description: 'Send through the Resend API and receive via Resend inbound webhooks. Works with any DNS host.',
  maxMessageBytes: 40 * 1024 * 1024,
  maxAttachments: 40,
  maxRecipients: 50,
  deliveryEvents: true,
  inbound: 'webhook',
  domainManagement: true,
  requiresCloudflareDns: false,
  webhookPath: '/api/webhooks/resend',
  docsUrl: 'https://resend.com/docs',
  credentialFields: [
    { name: 'RESEND_API_KEY', label: 'API key', secret: true, required: true, hint: 'Full access key (send + domains + receiving).' },
    {
      name: 'RESEND_WEBHOOK_SECRET',
      label: 'Webhook signing secret',
      secret: true,
      required: false,
      hint: 'Shown once when creating the webhook; Mailcove can create the webhook for you.',
    },
  ],
};

export type ResendCredentials = { RESEND_API_KEY?: string; RESEND_WEBHOOK_SECRET?: string };

const MAX_INLINE_HTML = 256 * 1024;

export function createResendProvider(credentials: ResendCredentials): MailProvider & { client: ResendClient | null; createWebhook(appBaseUrl: string): Promise<{ id: string; secret: string | null }> } {
  const client = credentials.RESEND_API_KEY ? new ResendClient(credentials.RESEND_API_KEY) : null;
  const requireClient = (): ResendClient => {
    if (!client) throw new ProviderError(400, 'resend_api_key_missing', 'RESEND_API_KEY is not configured.');
    return client;
  };

  return {
    kind: 'resend',
    capabilities: RESEND_CAPABILITIES,
    client,
    isConfigured: () => Boolean(client),

    async send(message: OutboundMessage): Promise<SendResult> {
      const api = requireClient();
      const result = await api.send(
        {
          from: formatAddress(message.from),
          to: message.to.map(formatAddress),
          ...(message.cc.length ? { cc: message.cc.map(formatAddress) } : {}),
          ...(message.bcc.length ? { bcc: message.bcc.map(formatAddress) } : {}),
          ...(message.replyTo ? { reply_to: [formatAddress(message.replyTo)] } : {}),
          subject: message.subject,
          ...(message.html ? { html: message.html } : {}),
          ...(message.text ? { text: message.text } : {}),
          ...(Object.keys(message.headers).length ? { headers: message.headers } : {}),
          ...(message.attachments.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  content: base64Encode(a.content),
                  content_type: a.contentType,
                  ...(a.contentId ? { content_id: a.contentId } : {}),
                })),
              }
            : {}),
        },
        message.idempotencyKey,
      );
      if (!result?.id) throw new ProviderError(502, 'missing_message_id', 'Resend did not return an email id', true);
      return { providerMessageId: result.id, status: 'queued', messageIdHeader: null };
    },

    async createDomain(name) {
      const api = requireClient();
      const existing = (await api.listDomains()).find((d) => d.name.toLowerCase() === name.toLowerCase());
      let domain: ResendDomain;
      if (existing) {
        domain = await api.getDomain(existing.id);
        if (domain.capabilities?.receiving !== 'enabled') {
          try {
            await api.enableReceiving(domain.id);
            domain = await api.getDomain(domain.id);
          } catch (error) {
            console.warn('resend enableReceiving failed', error);
          }
        }
      } else {
        domain = await api.createDomain(name);
      }
      return toDomainInfo(domain);
    },

    async getDomain(name, providerDomainId) {
      const api = requireClient();
      const id = providerDomainId ?? (await api.listDomains()).find((d) => d.name.toLowerCase() === name.toLowerCase())?.id;
      if (!id) throw new ProviderError(404, 'resend_domain_not_found', `${name} is not registered with Resend yet.`);
      return toDomainInfo(await api.getDomain(id));
    },

    async verifyDomain(name, providerDomainId, context) {
      const api = requireClient();
      const info = await this.getDomain(name, providerDomainId, context);
      if (info.providerDomainId) {
        try {
          await api.verifyDomain(info.providerDomainId);
        } catch (error) {
          console.warn('resend verify failed', error);
        }
        return toDomainInfo(await api.getDomain(info.providerDomainId));
      }
      return info;
    },

    async deleteDomain(_name, providerDomainId) {
      if (!providerDomainId) return;
      await requireClient().deleteDomain(providerDomainId);
    },

    async handleWebhook(request: Request): Promise<WebhookResult> {
      const rawBody = await request.text();
      if (!credentials.RESEND_WEBHOOK_SECRET) {
        throw new ProviderError(401, 'resend_webhook_secret_missing', 'RESEND_WEBHOOK_SECRET is not configured.');
      }
      const verified = await verifySvixSignature(request, rawBody, credentials.RESEND_WEBHOOK_SECRET);
      if (!verified.ok) throw new ProviderError(401, 'resend_webhook_invalid', `Webhook rejected: ${verified.reason}`);

      const payload = JSON.parse(rawBody) as {
        type: string;
        created_at?: string;
        data?: Record<string, unknown> & { email_id?: string; id?: string; from?: string; to?: string[]; subject?: string };
      };
      const data = payload.data ?? {};
      const emailId = String(data.email_id ?? data.id ?? '');
      if (!emailId) return { events: [] };
      const occurredAt = payload.created_at ? new Date(payload.created_at) : new Date();

      if (payload.type === 'email.received') {
        const event: InboundEvent = {
          kind: 'inbound',
          provider: 'resend',
          eventId: verified.id,
          providerMessageId: emailId,
          envelopeFrom: parseSingleAddress(String(data.from ?? ''))?.email ?? String(data.from ?? ''),
          envelopeTo: (Array.isArray(data.to) ? data.to : []).map((t) => parseSingleAddress(String(t))?.email ?? String(t)),
          fetchRef: emailId,
        };
        return { events: [event] };
      }

      const type = mapEventType(payload.type);
      if (!type) return { events: [] };
      const bounce = data.bounce as { message?: string; type?: string; subType?: string } | undefined;
      const event: DeliveryEvent = {
        kind: 'delivery',
        provider: 'resend',
        eventId: verified.id,
        providerMessageId: emailId,
        type,
        recipient: Array.isArray(data.to) ? String(data.to[0] ?? '') : null,
        detail: {
          resendType: payload.type,
          ...(bounce ? { bounce } : {}),
          ...(data.failed ? { failed: data.failed } : {}),
          ...(data.click ? { click: data.click } : {}),
        },
        occurredAt,
      };
      return { events: [event] };
    },

    async fetchInbound(fetchRef: string) {
      const api = requireClient();
      let email = await api.getReceivedEmail(fetchRef, 'data_uri');
      if ((email.html?.length ?? 0) > MAX_INLINE_HTML) {
        // Inline data URIs can blow past D1 row limits; cid references keep the body small.
        email = await api.getReceivedEmail(fetchRef, 'cid');
      }
      const attachmentsMeta = email.attachments?.length ? email.attachments : await api.listReceivedAttachments(fetchRef);
      const attachments = [];
      for (const meta of attachmentsMeta) {
        if (!meta.download_url) continue;
        try {
          const content = await api.download(meta.download_url);
          attachments.push({
            filename: meta.filename || 'attachment',
            contentType: meta.content_type || 'application/octet-stream',
            content,
            disposition: (meta.content_disposition === 'inline' ? 'inline' : 'attachment') as 'inline' | 'attachment',
            contentId: meta.content_id ?? null,
          });
        } catch (error) {
          console.warn('resend attachment download failed', meta.id, error);
        }
      }
      return { parsed: toParsedMail(email, attachments) };
    },

    async createWebhook(appBaseUrl: string) {
      const api = requireClient();
      const endpoint = `${appBaseUrl}${RESEND_CAPABILITIES.webhookPath}`;
      const existing = (await api.listWebhooks()).find((w) => w.endpoint === endpoint);
      if (existing) return { id: existing.id, secret: null };
      const created = await api.createWebhook(endpoint, RESEND_WEBHOOK_EVENTS);
      return { id: created.id, secret: created.signing_secret ?? created.secret ?? null };
    },
  };
}

function mapEventType(type: string): DeliveryEventType | null {
  switch (type) {
    case 'email.sent':
      return 'sent';
    case 'email.delivered':
      return 'delivered';
    case 'email.delivery_delayed':
      return 'delayed';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    case 'email.failed':
      return 'failed';
    case 'email.opened':
      return 'opened';
    case 'email.clicked':
      return 'clicked';
    default:
      return null;
  }
}

function toDomainInfo(domain: ResendDomain): ProviderDomainInfo {
  const records: DnsRecord[] = (domain.records ?? []).map((r) => ({
    type: r.type,
    name: r.name,
    value: r.value,
    priority: r.priority ?? null,
    ttl: r.ttl ?? null,
    status: r.status === 'verified' ? 'verified' : r.status === 'failed' ? 'failed' : 'pending',
    purpose: r.record,
  }));
  const verified = domain.status === 'verified';
  const notes: string[] = [];
  if (domain.capabilities?.receiving !== 'enabled') {
    notes.push('Receiving is not enabled for this domain in Resend. Enable it under Domains → Receiving and add the MX record.');
  }
  return {
    providerDomainId: domain.id,
    name: domain.name,
    status: verified ? 'verified' : domain.status === 'failed' ? 'failed' : 'pending',
    sendingEnabled: verified && domain.capabilities?.sending !== 'disabled',
    receivingEnabled: verified && domain.capabilities?.receiving === 'enabled',
    records,
    notes,
  };
}

function toParsedMail(email: ResendReceivedEmail, attachments: ParsedMail['attachments']): ParsedMail {
  const headers: Record<string, string> = {};
  if (Array.isArray(email.headers)) {
    for (const h of email.headers) headers[h.name.toLowerCase()] = h.value;
  } else if (email.headers) {
    for (const [k, v] of Object.entries(email.headers)) headers[k.toLowerCase()] = String(v);
  }
  const from = parseSingleAddress(email.from) ?? { email: email.from, name: null };
  const size = (email.html?.length ?? 0) + (email.text?.length ?? 0) + attachments.reduce((n, a) => n + a.content.byteLength, 0);
  return {
    messageId: email.message_id ?? headers['message-id'] ?? null,
    inReplyTo: headers['in-reply-to'] ?? null,
    references: headers['references'] ?? null,
    from,
    to: parseAddressList((email.to ?? []).join(', ')),
    cc: parseAddressList((email.cc ?? []).join(', ')),
    bcc: parseAddressList((email.bcc ?? []).join(', ')),
    replyTo: parseAddressList((email.reply_to ?? []).join(', ')),
    subject: email.subject ?? '',
    date: email.created_at ? new Date(email.created_at) : null,
    text: email.text,
    html: email.html,
    headers,
    attachments,
    sizeBytes: size,
  };
}
