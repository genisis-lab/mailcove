import { ProviderError } from '../types';

const API_BASE = 'https://api.resend.com';

export type ResendDomainRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  status?: string;
  priority?: number;
};

export type ResendDomain = {
  id: string;
  name: string;
  status: 'not_started' | 'pending' | 'verified' | 'failed' | 'temporary_failure';
  region?: string;
  capabilities?: { sending?: 'enabled' | 'disabled'; receiving?: 'enabled' | 'disabled' };
  records?: ResendDomainRecord[];
};

export type ResendSendPayload = {
  from: string;
  to: string[];
  subject: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: string; content_type?: string; content_id?: string }>;
};

export type ResendReceivedAttachment = {
  id: string;
  filename: string;
  content_type: string;
  content_disposition?: string;
  content_id?: string;
  size?: number;
  download_url?: string;
};

export type ResendReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  headers?: Record<string, string> | Array<{ name: string; value: string }>;
  created_at: string;
  message_id?: string | null;
  attachments?: ResendReceivedAttachment[];
};

type ListResponse<T> = { data: T[]; has_more?: boolean };

/** Minimal fetch-based Resend client. Shape adapted from QuickInbox (MIT). */
export class ResendClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
    const { idempotencyKey, ...rest } = init;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...((rest.headers as Record<string, string>) ?? {}),
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await fetch(`${API_BASE}${path}`, { ...rest, headers });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const err = (parsed ?? {}) as { name?: string; message?: string };
      throw new ProviderError(
        response.status >= 500 || response.status === 429 ? 502 : 400,
        err.name ?? `resend_http_${response.status}`,
        err.message ?? `Resend request failed (${response.status})`,
        response.status >= 500 || response.status === 429,
      );
    }
    return parsed as T;
  }

  send(payload: ResendSendPayload, idempotencyKey: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('/emails', { method: 'POST', body: JSON.stringify(payload), idempotencyKey });
  }

  async listDomains(): Promise<ResendDomain[]> {
    const result = await this.request<ListResponse<ResendDomain>>('/domains?limit=100');
    return result?.data ?? [];
  }

  getDomain(id: string): Promise<ResendDomain> {
    return this.request<ResendDomain>(`/domains/${id}`);
  }

  createDomain(name: string): Promise<ResendDomain> {
    return this.request<ResendDomain>('/domains', {
      method: 'POST',
      body: JSON.stringify({ name, capabilities: { sending: 'enabled', receiving: 'enabled' } }),
    });
  }

  async enableReceiving(id: string): Promise<void> {
    await this.request(`/domains/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capabilities: { sending: 'enabled', receiving: 'enabled' } }),
    });
  }

  verifyDomain(id: string): Promise<unknown> {
    return this.request(`/domains/${id}/verify`, { method: 'POST', body: '{}' });
  }

  async deleteDomain(id: string): Promise<void> {
    await this.request(`/domains/${id}`, { method: 'DELETE' });
  }

  getReceivedEmail(id: string, htmlFormat: 'data_uri' | 'cid' = 'data_uri'): Promise<ResendReceivedEmail> {
    return this.request<ResendReceivedEmail>(`/emails/receiving/${id}?html_format=${htmlFormat}`);
  }

  async listReceivedAttachments(id: string): Promise<ResendReceivedAttachment[]> {
    const result = await this.request<ListResponse<ResendReceivedAttachment>>(`/emails/receiving/${id}/attachments`);
    return result?.data ?? [];
  }

  async download(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ProviderError(502, 'attachment_download_failed', `Failed to download attachment (${response.status})`, true);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  createWebhook(endpoint: string, events: string[]): Promise<{ id: string; signing_secret?: string; secret?: string }> {
    return this.request('/webhooks', { method: 'POST', body: JSON.stringify({ endpoint, events }) });
  }

  async listWebhooks(): Promise<Array<{ id: string; endpoint: string; events: string[]; status?: string }>> {
    const result = await this.request<ListResponse<{ id: string; endpoint: string; events: string[]; status?: string }>>('/webhooks');
    return result?.data ?? [];
  }
}

export const RESEND_WEBHOOK_EVENTS = [
  'email.received',
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.opened',
  'email.clicked',
];
