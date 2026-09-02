import type { DnsRecord } from '../../../../shared/types';
import {
  ProviderError,
  providerError,
  type DomainContext,
  type MailProvider,
  type OutboundMessage,
  type ProviderCapabilities,
  type ProviderDomainInfo,
  type SendResult,
} from '../types';
import { CloudflareApi, idOf, type CfDnsRecord } from './api';

export const CLOUDFLARE_CAPABILITIES: ProviderCapabilities = {
  kind: 'cloudflare',
  label: 'Cloudflare Email Service',
  description: 'Inbound via Email Routing to this Worker, outbound through the send_email binding. Requires Cloudflare DNS and a Workers paid plan.',
  maxMessageBytes: 5 * 1024 * 1024,
  maxAttachments: 32,
  maxRecipients: 50,
  deliveryEvents: false,
  inbound: 'worker',
  domainManagement: true,
  requiresCloudflareDns: true,
  webhookPath: null,
  docsUrl: 'https://developers.cloudflare.com/email-service/',
  credentialFields: [
    {
      name: 'CF_API_TOKEN',
      label: 'Cloudflare API token',
      secret: true,
      required: true,
      hint: 'Permissions: Zone Read, Email Routing Edit, Email Sending Edit for the zones you will connect.',
    },
    { name: 'CF_ACCOUNT_ID', label: 'Cloudflare account ID', secret: false, required: false, hint: 'Needed for D1 backups only.' },
  ],
};

export type CloudflareCredentials = { CF_API_TOKEN?: string; CF_ACCOUNT_ID?: string };

export function createCloudflareProvider(binding: SendEmail | undefined, credentials: CloudflareCredentials): MailProvider {
  const api = credentials.CF_API_TOKEN ? new CloudflareApi(credentials.CF_API_TOKEN) : null;

  const requireApi = (): CloudflareApi => {
    if (!api) {
      throw new ProviderError(
        400,
        'cloudflare_token_missing',
        'Set CF_API_TOKEN (Zone Read, Email Routing Edit, Email Sending Edit) to manage domains from the admin panel.',
      );
    }
    return api;
  };

  return {
    kind: 'cloudflare',
    capabilities: CLOUDFLARE_CAPABILITIES,
    isConfigured: () => Boolean(binding),

    async send(message: OutboundMessage): Promise<SendResult> {
      if (!binding) {
        throw new ProviderError(400, 'send_email_binding_missing', 'The EMAIL send_email binding is not configured for this Worker.');
      }
      try {
        const result = await binding.send({
          from: { email: message.from.email, name: message.from.name ?? '' },
          to: message.to.map(toCf),
          ...(message.cc.length ? { cc: message.cc.map(toCf) } : {}),
          ...(message.bcc.length ? { bcc: message.bcc.map(toCf) } : {}),
          ...(message.replyTo ? { replyTo: toCf(message.replyTo) } : {}),
          subject: message.subject,
          ...(message.text ? { text: message.text } : {}),
          ...(message.html ? { html: message.html } : {}),
          ...(Object.keys(message.headers).length ? { headers: filterHeaders(message.headers) } : {}),
          ...(message.attachments.length
            ? {
                attachments: message.attachments.map((a) =>
                  a.disposition === 'inline' && a.contentId
                    ? {
                        disposition: 'inline' as const,
                        contentId: a.contentId,
                        filename: a.filename,
                        type: a.contentType,
                        content: toArrayBuffer(a.content),
                      }
                    : {
                        disposition: 'attachment' as const,
                        filename: a.filename,
                        type: a.contentType,
                        content: toArrayBuffer(a.content),
                      },
                ),
              }
            : {}),
        });
        if (!result?.messageId) {
          throw new ProviderError(502, 'missing_message_id', 'Cloudflare Email Service did not return a message id', true);
        }
        return { providerMessageId: result.messageId, status: 'sent', messageIdHeader: null };
      } catch (error) {
        throw providerError(error, 'cloudflare_send_failed');
      }
    },

    async createDomain(name, context) {
      const cf = requireApi();
      const zone = await cf.findZone(name);
      if (!zone) {
        throw new ProviderError(400, 'zone_not_found', `${name} is not an active zone on this Cloudflare account (or the token cannot read it).`);
      }
      const notes: string[] = [];

      // Receiving: enable routing, then point the catch-all at this Worker.
      try {
        const settings = await cf.getRoutingSettings(zone.id);
        if (!settings.enabled) await cf.enableRouting(zone.id);
      } catch (error) {
        notes.push(`Email Routing could not be enabled automatically: ${(error as Error).message}`);
      }
      try {
        await cf.setCatchAllToWorker(zone.id, context.workerName);
      } catch (error) {
        notes.push(
          `Could not point the catch-all at the "${context.workerName}" Worker: ${(error as Error).message}. Set it manually under Email Routing → Routing rules.`,
        );
      }

      // Sending: onboard the domain for Email Sending.
      try {
        const existing = await cf.listSendingSubdomains(zone.id);
        if (!existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
          await cf.createSendingSubdomain(zone.id, name);
        }
      } catch (error) {
        notes.push(`Email Sending onboarding failed: ${(error as Error).message}. Requires a Workers paid plan.`);
      }

      const info = await describeDomain(cf, name, zone.id, context);
      return { ...info, notes: [...(info.notes ?? []), ...notes] };
    },

    async getDomain(name, _providerDomainId, context) {
      const cf = requireApi();
      const zone = await cf.findZone(name);
      if (!zone) throw new ProviderError(400, 'zone_not_found', `${name} is not an active zone on this Cloudflare account.`);
      return describeDomain(cf, name, zone.id, context);
    },

    async verifyDomain(name, providerDomainId, context) {
      return this.getDomain(name, providerDomainId, context);
    },

    async deleteDomain(name, _providerDomainId, _context) {
      const cf = requireApi();
      const zone = await cf.findZone(name);
      if (!zone) return;
      try {
        await cf.disableCatchAll(zone.id);
      } catch (error) {
        console.warn('disable catch-all failed', error);
      }
      try {
        const subs = await cf.listSendingSubdomains(zone.id);
        const match = subs.find((s) => s.name.toLowerCase() === name.toLowerCase());
        const id = match ? idOf(match) : null;
        if (id) await cf.deleteSendingSubdomain(zone.id, id);
      } catch (error) {
        console.warn('delete sending subdomain failed', error);
      }
    },
  };
}

async function describeDomain(cf: CloudflareApi, name: string, zoneId: string, context: DomainContext): Promise<ProviderDomainInfo> {
  const notes: string[] = [];
  const records: DnsRecord[] = [];
  let receivingEnabled = false;
  let sendingEnabled = false;

  try {
    const settings = await cf.getRoutingSettings(zoneId);
    receivingEnabled = Boolean(settings.enabled) && (settings.status ? settings.status === 'ready' : true);
    const dns = await cf.getRoutingDns(zoneId);
    for (const r of dns) records.push(toDnsRecord(r, 'Email Routing', receivingEnabled ? 'verified' : 'pending'));
  } catch (error) {
    notes.push(`Routing status unavailable: ${(error as Error).message}`);
  }

  try {
    const catchAll = await cf.getCatchAll(zoneId);
    const targetsWorker =
      catchAll.enabled && catchAll.actions.some((a) => a.type === 'worker' && (a.value ?? []).includes(context.workerName));
    if (!targetsWorker) {
      receivingEnabled = false;
      notes.push(`The catch-all rule does not target the "${context.workerName}" Worker yet.`);
    }
  } catch (error) {
    notes.push(`Catch-all status unavailable: ${(error as Error).message}`);
  }

  try {
    const subs = await cf.listSendingSubdomains(zoneId);
    const match = subs.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (match) {
      const verified = match.verified ?? match.enabled ?? (match.status ? /ready|active|verified/i.test(match.status) : false);
      sendingEnabled = Boolean(verified);
      const id = idOf(match);
      if (id) {
        try {
          const dns = await cf.getSendingSubdomainDns(zoneId, id);
          for (const r of dns) records.push(toDnsRecord(r, 'Email Sending', sendingEnabled ? 'verified' : 'pending'));
        } catch {
          for (const r of match.dns_records ?? []) records.push(toDnsRecord(r, 'Email Sending', sendingEnabled ? 'verified' : 'pending'));
        }
      }
    } else {
      notes.push('Domain is not onboarded for Email Sending. Onboard it to send mail.');
    }
  } catch (error) {
    notes.push(`Sending status unavailable: ${(error as Error).message}`);
  }

  const status: ProviderDomainInfo['status'] = receivingEnabled && sendingEnabled ? 'verified' : 'pending';
  return {
    providerDomainId: zoneId,
    name,
    status,
    sendingEnabled,
    receivingEnabled,
    records,
    notes,
    zoneId,
  };
}

function toDnsRecord(r: CfDnsRecord, purpose: string, status: DnsRecord['status']): DnsRecord {
  return { type: r.type, name: r.name, value: r.content, priority: r.priority ?? null, ttl: r.ttl ?? null, status, purpose };
}

function toCf(address: { email: string; name?: string | null }): EmailAddress {
  return { email: address.email, name: address.name ?? '' };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const HEADER_BLOCKLIST = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'reply-to', 'date', 'message-id', 'content-type', 'mime-version']);

function filterHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HEADER_BLOCKLIST.has(key.toLowerCase())) continue;
    if (!value) continue;
    out[key] = value.slice(0, 2000);
  }
  return out;
}
