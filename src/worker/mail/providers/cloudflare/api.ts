import { ProviderError } from '../types';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export type CfZone = { id: string; name: string; status: string };
export type CfRoutingSettings = { enabled: boolean; status?: string; name?: string; skip_wizard?: boolean };
export type CfDnsRecord = { type: string; name: string; content: string; priority?: number; ttl?: number };
export type CfRoutingDns = { record?: CfDnsRecord[]; errors?: Array<{ code: string; missing?: CfDnsRecord }> } | CfDnsRecord[];
export type CfCatchAll = {
  enabled: boolean;
  name?: string;
  matchers: Array<{ type: 'all' }>;
  actions: Array<{ type: 'worker' | 'forward' | 'drop'; value?: string[] }>;
};
export type CfSendingSubdomain = {
  id?: string;
  tag?: string;
  name: string;
  enabled?: boolean;
  status?: string;
  verified?: boolean;
  dns_records?: CfDnsRecord[];
};

type CfEnvelope<T> = { success: boolean; result: T; errors?: Array<{ code: number; message: string }> };

/** Thin client over the Cloudflare REST API endpoints Mailcove needs. */
export class CloudflareApi {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await response.text();
    let body: CfEnvelope<T> | null = null;
    try {
      body = text ? (JSON.parse(text) as CfEnvelope<T>) : null;
    } catch {
      body = null;
    }
    if (!response.ok || !body?.success) {
      const first = body?.errors?.[0];
      const code = first ? `cf_${first.code}` : `cf_http_${response.status}`;
      const message = first?.message ?? `Cloudflare API request failed (${response.status})`;
      throw new ProviderError(response.status >= 500 ? 502 : 400, code, message, response.status >= 500);
    }
    return body.result;
  }

  async findZone(hostname: string): Promise<CfZone | null> {
    // Try the hostname, then each parent, so "mail.example.com" resolves to the example.com zone.
    const labels = hostname.toLowerCase().split('.');
    for (let i = 0; i <= labels.length - 2; i++) {
      const candidate = labels.slice(i).join('.');
      const zones = await this.request<CfZone[]>(`/zones?name=${encodeURIComponent(candidate)}&status=active&per_page=5`);
      const match = zones.find((z) => z.name === candidate);
      if (match) return match;
    }
    return null;
  }

  async getRoutingSettings(zoneId: string): Promise<CfRoutingSettings> {
    return this.request<CfRoutingSettings>(`/zones/${zoneId}/email/routing`);
  }

  async enableRouting(zoneId: string): Promise<CfRoutingSettings> {
    return this.request<CfRoutingSettings>(`/zones/${zoneId}/email/routing/enable`, { method: 'POST', body: '{}' });
  }

  async disableRouting(zoneId: string): Promise<void> {
    await this.request(`/zones/${zoneId}/email/routing/disable`, { method: 'POST', body: '{}' });
  }

  async getRoutingDns(zoneId: string): Promise<CfDnsRecord[]> {
    const result = await this.request<CfRoutingDns>(`/zones/${zoneId}/email/routing/dns`);
    if (Array.isArray(result)) return result;
    return result.record ?? [];
  }

  async getCatchAll(zoneId: string): Promise<CfCatchAll> {
    return this.request<CfCatchAll>(`/zones/${zoneId}/email/routing/rules/catch_all`);
  }

  async setCatchAllToWorker(zoneId: string, workerName: string): Promise<CfCatchAll> {
    return this.request<CfCatchAll>(`/zones/${zoneId}/email/routing/rules/catch_all`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        name: 'Mailcove inbox',
        matchers: [{ type: 'all' }],
        actions: [{ type: 'worker', value: [workerName] }],
      }),
    });
  }

  async disableCatchAll(zoneId: string): Promise<void> {
    await this.request(`/zones/${zoneId}/email/routing/rules/catch_all`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false, matchers: [{ type: 'all' }], actions: [{ type: 'drop' }] }),
    });
  }

  async listSendingSubdomains(zoneId: string): Promise<CfSendingSubdomain[]> {
    return this.request<CfSendingSubdomain[]>(`/zones/${zoneId}/email/sending/subdomains`);
  }

  async createSendingSubdomain(zoneId: string, name: string): Promise<CfSendingSubdomain> {
    return this.request<CfSendingSubdomain>(`/zones/${zoneId}/email/sending/subdomains`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async deleteSendingSubdomain(zoneId: string, subdomainId: string): Promise<void> {
    await this.request(`/zones/${zoneId}/email/sending/subdomains/${subdomainId}`, { method: 'DELETE' });
  }

  async getSendingSubdomainDns(zoneId: string, subdomainId: string): Promise<CfDnsRecord[]> {
    const result = await this.request<CfRoutingDns>(`/zones/${zoneId}/email/sending/subdomains/${subdomainId}/dns`);
    if (Array.isArray(result)) return result;
    return result.record ?? [];
  }

  async verifyToken(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/user/tokens/verify');
  }

  /** D1 export used by backups. Returns a signed URL once the export finishes. */
  async exportD1(accountId: string, databaseId: string, bookmark?: string): Promise<{ status?: string; signed_url?: string; at_bookmark?: string; result?: { signed_url?: string } }> {
    return this.request(`/accounts/${accountId}/d1/database/${databaseId}/export`, {
      method: 'POST',
      body: JSON.stringify({ output_format: 'polling', ...(bookmark ? { current_bookmark: bookmark } : {}) }),
    });
  }
}

export function idOf(subdomain: CfSendingSubdomain): string | null {
  return subdomain.id ?? subdomain.tag ?? null;
}
