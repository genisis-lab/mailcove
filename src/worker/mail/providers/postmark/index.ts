import { formatAddress, parseAddressList, parseSingleAddress } from '../../../../shared/address';
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

const API = 'https://api.postmarkapp.com';

export const POSTMARK_CAPABILITIES: ProviderCapabilities = {
  kind: 'postmark',
  label: 'Postmark',
  description: 'Transactional sending via Postmark with inbound processing through the Postmark inbound webhook.',
  maxMessageBytes: 10 * 1024 * 1024,
  maxAttachments: 50,
  maxRecipients: 50,
  deliveryEvents: true,
  inbound: 'webhook',
  domainManagement: true,
  requiresCloudflareDns: false,
  webhookPath: '/api/webhooks/postmark',
  docsUrl: 'https://postmarkapp.com/developer',
  credentialFields: [
    { name: 'POSTMARK_SERVER_TOKEN', label: 'Server API token', secret: true, required: true },
    { name: 'POSTMARK_ACCOUNT_TOKEN', label: 'Account API token', secret: true, required: false, hint: 'Needed to add and verify domains.' },
    {
      name: 'POSTMARK_WEBHOOK_SECRET',
      label: 'Webhook secret',
      secret: true,
      required: false,
      hint: 'Append ?token=<secret> to the webhook URL in Postmark, or use it as the HTTP basic-auth password.',
    },
  ],
};

type Credentials = { POSTMARK_SERVER_TOKEN?: string; POSTMARK_ACCOUNT_TOKEN?: string; POSTMARK_WEBHOOK_SECRET?: string };

type PostmarkDomain = {
  ID: number;
  Name: string;
  SPFVerified?: boolean;
  DKIMVerified?: boolean;
  WeakDKIM?: boolean;
  DKIMHost?: string;
  DKIMTextValue?: string;
  DKIMPendingHost?: string;
  DKIMPendingTextValue?: string;
  ReturnPathDomain?: string;
  ReturnPathDomainVerified?: boolean;
  ReturnPathDomainCNAMEValue?: string;
};

export function createPostmarkProvider(credentials: Credentials): MailProvider {
  const serverToken = credentials.POSTMARK_SERVER_TOKEN;
  const accountToken = credentials.POSTMARK_ACCOUNT_TOKEN;

  async function request<T>(path: string, token: string | undefined, header: string, init: RequestInit = {}): Promise<T> {
    if (!token) throw new ProviderError(400, 'postmark_token_missing', `${header} is not configured.`);
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', [header]: token, ...(init.headers as Record<string, string>) },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const err = (body ?? {}) as { ErrorCode?: number; Message?: string };
      const retryable = response.status >= 500 || response.status === 429;
      throw new ProviderError(retryable ? 502 : 400, `postmark_${err.ErrorCode ?? response.status}`, err.Message ?? `Postmark request failed (${response.status})`, retryable);
    }
    return body as T;
  }

  const server = <T>(path: string, init?: RequestInit) => request<T>(path, serverToken, 'X-Postmark-Server-Token', init);
  const account = <T>(path: string, init?: RequestInit) => request<T>(path, accountToken, 'X-Postmark-Account-Token', init);

  return {
    kind: 'postmark',
    capabilities: POSTMARK_CAPABILITIES,
    isConfigured: () => Boolean(serverToken),

    async send(message: OutboundMessage): Promise<SendResult> {
      const result = await server<{ MessageID: string }>('/email', {
        method: 'POST',
        body: JSON.stringify({
          From: formatAddress(message.from),
          To: message.to.map(formatAddress).join(', '),
          ...(message.cc.length ? { Cc: message.cc.map(formatAddress).join(', ') } : {}),
          ...(message.bcc.length ? { Bcc: message.bcc.map(formatAddress).join(', ') } : {}),
          ...(message.replyTo ? { ReplyTo: formatAddress(message.replyTo) } : {}),
          Subject: message.subject,
          ...(message.html ? { HtmlBody: message.html } : {}),
          ...(message.text ? { TextBody: message.text } : {}),
          Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })),
          Attachments: message.attachments.map((a) => ({
            Name: a.filename,
            Content: base64Encode(a.content),
            ContentType: a.contentType,
            ...(a.contentId ? { ContentID: a.disposition === 'inline' ? `cid:${a.contentId}` : a.contentId } : {}),
          })),
          MessageStream: 'outbound',
        }),
      });
      return { providerMessageId: result.MessageID, status: 'queued', messageIdHeader: null };
    },

    async createDomain(name, context) {
      const existing = await findDomain(name);
      const domain = existing ?? (await account<PostmarkDomain>('/domains', { method: 'POST', body: JSON.stringify({ Name: name, ReturnPathDomain: `pm-bounces.${name}` }) }));
      // Point the server's inbound hook at Mailcove so inbound mail arrives here.
      try {
        await server('/server', {
          method: 'PUT',
          body: JSON.stringify({ InboundHookUrl: webhookUrl(context.appBaseUrl, credentials), InboundDomain: name }),
        });
      } catch (error) {
        console.warn('postmark inbound hook configuration failed', error);
      }
      return toDomainInfo(await account<PostmarkDomain>(`/domains/${domain.ID}`), context.appBaseUrl);
    },

    async getDomain(name, providerDomainId, context) {
      const id = providerDomainId ?? (await findDomain(name))?.ID;
      if (!id) throw new ProviderError(404, 'postmark_domain_not_found', `${name} is not registered with Postmark yet.`);
      return toDomainInfo(await account<PostmarkDomain>(`/domains/${id}`), context.appBaseUrl);
    },

    async verifyDomain(name, providerDomainId, context) {
      const id = providerDomainId ?? (await findDomain(name))?.ID;
      if (!id) throw new ProviderError(404, 'postmark_domain_not_found', `${name} is not registered with Postmark yet.`);
      for (const path of ['verifyDkim', 'verifyReturnPath']) {
        try {
          await account(`/domains/${id}/${path}`, { method: 'PUT', body: '{}' });
        } catch (error) {
          console.warn(`postmark ${path} failed`, error);
        }
      }
      return toDomainInfo(await account<PostmarkDomain>(`/domains/${id}`), context.appBaseUrl);
    },

    async deleteDomain(_name, providerDomainId) {
      if (!providerDomainId) return;
      await account(`/domains/${providerDomainId}`, { method: 'DELETE' });
    },

    async handleWebhook(request: Request): Promise<WebhookResult> {
      await authenticate(request, credentials.POSTMARK_WEBHOOK_SECRET);
      const payload = (await request.json()) as Record<string, unknown>;
      const recordType = String(payload.RecordType ?? '');
      const messageId = String(payload.MessageID ?? '');

      if (!recordType || recordType === 'Inbound' || payload.FromFull) {
        const parsed = inboundToParsed(payload);
        const eventId = `postmark:${messageId || (await sha256Hex(JSON.stringify(payload)))}`;
        const event: InboundEvent = {
          kind: 'inbound',
          provider: 'postmark',
          eventId,
          providerMessageId: messageId || eventId,
          envelopeFrom: parsed.from.email,
          envelopeTo: [String(payload.OriginalRecipient ?? parsed.to[0]?.email ?? '')].filter(Boolean),
          parsed,
        };
        return { events: [event] };
      }

      const type = mapRecordType(recordType, payload);
      if (!type) return { events: [] };
      const occurredRaw = payload.DeliveredAt ?? payload.BouncedAt ?? payload.ReceivedAt ?? payload.ChangedAt;
      const event: DeliveryEvent = {
        kind: 'delivery',
        provider: 'postmark',
        eventId: `postmark:${recordType}:${messageId}:${payload.ID ?? occurredRaw ?? ''}`,
        providerMessageId: messageId,
        type,
        recipient: String(payload.Recipient ?? payload.Email ?? '') || null,
        detail: { recordType, type: payload.Type, description: payload.Description, details: payload.Details },
        occurredAt: occurredRaw ? new Date(String(occurredRaw)) : new Date(),
      };
      return { events: [event] };
    },
  };

  async function findDomain(name: string): Promise<PostmarkDomain | null> {
    const list = await account<{ Domains: PostmarkDomain[] }>('/domains?count=100&offset=0');
    return list.Domains.find((d) => d.Name.toLowerCase() === name.toLowerCase()) ?? null;
  }
}

function webhookUrl(appBaseUrl: string, credentials: Credentials): string {
  const url = `${appBaseUrl}${POSTMARK_CAPABILITIES.webhookPath}`;
  return credentials.POSTMARK_WEBHOOK_SECRET ? `${url}?token=${encodeURIComponent(credentials.POSTMARK_WEBHOOK_SECRET)}` : url;
}

async function authenticate(request: Request, secret: string | undefined): Promise<void> {
  if (!secret) return;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (token && timingSafeEqual(token, secret)) return;
  const basic = request.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const decoded = new TextDecoder().decode(base64Decode(basic));
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (timingSafeEqual(password, secret)) return;
  }
  throw new ProviderError(401, 'postmark_webhook_unauthorized', 'Webhook token mismatch');
}

function mapRecordType(recordType: string, payload: Record<string, unknown>): DeliveryEventType | null {
  switch (recordType) {
    case 'Delivery':
      return 'delivered';
    case 'Bounce':
      return /transient|soft|DnsError|Transient/i.test(String(payload.Type ?? '')) ? 'delayed' : 'bounced';
    case 'SpamComplaint':
      return 'complained';
    case 'Open':
      return 'opened';
    case 'Click':
      return 'clicked';
    case 'SubscriptionChange':
      return 'unsubscribed';
    default:
      return null;
  }
}

type PostmarkFull = { Email?: string; Name?: string };

function inboundToParsed(payload: Record<string, unknown>): ParsedMail {
  const headers: Record<string, string> = {};
  for (const h of (payload.Headers as Array<{ Name: string; Value: string }> | undefined) ?? []) {
    headers[h.Name.toLowerCase()] = h.Value;
  }
  const fromFull = payload.FromFull as PostmarkFull | undefined;
  const from = fromFull?.Email
    ? { email: fromFull.Email.toLowerCase(), name: fromFull.Name || null }
    : parseSingleAddress(String(payload.From ?? '')) ?? { email: String(payload.From ?? ''), name: null };
  const fullList = (list: unknown): ParsedMail['to'] =>
    ((list as PostmarkFull[] | undefined) ?? []).filter((x) => x.Email).map((x) => ({ email: x.Email!.toLowerCase(), name: x.Name || null }));
  const attachments: ParsedMail['attachments'] = [];
  for (const a of (payload.Attachments as Array<{ Name: string; Content: string; ContentType: string; ContentID?: string }> | undefined) ?? []) {
    try {
      attachments.push({
        filename: a.Name || 'attachment',
        contentType: a.ContentType || 'application/octet-stream',
        content: base64Decode(a.Content),
        disposition: a.ContentID ? 'inline' : 'attachment',
        contentId: a.ContentID?.replace(/^cid:/, '') ?? null,
      });
    } catch (error) {
      console.warn('postmark attachment decode failed', error);
    }
  }
  const text = (payload.TextBody as string | undefined) ?? null;
  const html = (payload.HtmlBody as string | undefined) ?? null;
  return {
    messageId: headers['message-id'] ?? (payload.MessageID ? `<${payload.MessageID}@mtasv.net>` : null),
    inReplyTo: headers['in-reply-to'] ?? null,
    references: headers['references'] ?? null,
    from,
    to: fullList(payload.ToFull).length ? fullList(payload.ToFull) : parseAddressList(String(payload.To ?? '')),
    cc: fullList(payload.CcFull),
    bcc: fullList(payload.BccFull),
    replyTo: parseAddressList(String(payload.ReplyTo ?? '')),
    subject: String(payload.Subject ?? ''),
    date: payload.Date ? new Date(String(payload.Date)) : null,
    text,
    html,
    headers,
    attachments,
    sizeBytes: (text?.length ?? 0) + (html?.length ?? 0) + attachments.reduce((n, a) => n + a.content.byteLength, 0),
  };
}

function toDomainInfo(domain: PostmarkDomain, appBaseUrl: string): ProviderDomainInfo {
  const records: DnsRecord[] = [];
  const dkimHost = domain.DKIMPendingHost || domain.DKIMHost;
  const dkimValue = domain.DKIMPendingTextValue || domain.DKIMTextValue;
  if (dkimHost && dkimValue) {
    records.push({ type: 'TXT', name: dkimHost, value: dkimValue, status: domain.DKIMVerified ? 'verified' : 'pending', purpose: 'DKIM' });
  }
  if (domain.ReturnPathDomain && domain.ReturnPathDomainCNAMEValue) {
    records.push({
      type: 'CNAME',
      name: domain.ReturnPathDomain,
      value: domain.ReturnPathDomainCNAMEValue,
      status: domain.ReturnPathDomainVerified ? 'verified' : 'pending',
      purpose: 'Return-Path',
    });
  }
  records.push({ type: 'MX', name: domain.Name, value: 'inbound.postmarkapp.com', priority: 10, status: 'unknown', purpose: 'Inbound' });
  const sendingEnabled = Boolean(domain.DKIMVerified);
  return {
    providerDomainId: String(domain.ID),
    name: domain.Name,
    status: sendingEnabled ? 'verified' : 'pending',
    sendingEnabled,
    receivingEnabled: true,
    records,
    notes: [
      `Set the inbound webhook to ${appBaseUrl}${POSTMARK_CAPABILITIES.webhookPath} on your Postmark server and enable the bounce, delivery and spam complaint webhooks with the same URL.`,
    ],
  };
}
