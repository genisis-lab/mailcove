import type { Address, DnsRecord, MailProviderKind, MessageStatus } from '../../../shared/types';

export type OutboundAttachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
  disposition: 'attachment' | 'inline';
  contentId?: string | null;
};

export type OutboundMessage = {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo?: Address | null;
  subject: string;
  text?: string | null;
  html?: string | null;
  headers: Record<string, string>;
  attachments: OutboundAttachment[];
  /** Stable key so provider retries never double-send. */
  idempotencyKey: string;
};

export type SendResult = {
  providerMessageId: string;
  /** What we can assert immediately after the API accepted the message. */
  status: Extract<MessageStatus, 'sent' | 'queued'>;
  /** RFC 5322 Message-ID when the provider reports it. */
  messageIdHeader?: string | null;
};

export type ParsedAttachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
  disposition: 'attachment' | 'inline';
  contentId?: string | null;
};

/** Provider-neutral representation of a received message. */
export type ParsedMail = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  date: Date | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  attachments: ParsedAttachment[];
  sizeBytes: number;
};

export type InboundEvent = {
  kind: 'inbound';
  provider: MailProviderKind;
  /** Provider-side identifier used for idempotency. */
  eventId: string;
  providerMessageId: string;
  envelopeFrom: string;
  envelopeTo: string[];
  /** Raw MIME when the provider hands it over directly. */
  raw?: Uint8Array;
  /** Already-parsed content when the provider only offers JSON. */
  parsed?: ParsedMail;
  /** Opaque reference for providers where content must be fetched later. */
  fetchRef?: string;
};

export type DeliveryEventType =
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'unsubscribed';

export type DeliveryEvent = {
  kind: 'delivery';
  provider: MailProviderKind;
  eventId: string;
  providerMessageId: string;
  type: DeliveryEventType;
  recipient?: string | null;
  detail?: Record<string, unknown>;
  occurredAt: Date;
};

export type ProviderEvent = InboundEvent | DeliveryEvent;

export type WebhookResult = {
  events: ProviderEvent[];
  /** Custom acknowledgement when the provider expects a specific body. */
  response?: Response;
};

export type ProviderDomainInfo = {
  providerDomainId: string | null;
  name: string;
  status: 'pending' | 'verified' | 'failed';
  sendingEnabled: boolean;
  receivingEnabled: boolean;
  records: DnsRecord[];
  /** Human-readable next steps when something still needs the operator. */
  notes?: string[];
  zoneId?: string | null;
};

export type ProviderCapabilities = {
  kind: MailProviderKind;
  label: string;
  description: string;
  maxMessageBytes: number;
  maxAttachments: number;
  maxRecipients: number;
  deliveryEvents: boolean;
  inbound: 'worker' | 'webhook';
  domainManagement: boolean;
  requiresCloudflareDns: boolean;
  /** Path (relative to APP_BASE_URL) the provider must POST webhooks to. */
  webhookPath: string | null;
  docsUrl: string;
  /** Credential fields the admin panel should collect. Names match env vars. */
  credentialFields: Array<{ name: string; label: string; secret: boolean; required: boolean; hint?: string }>;
};

export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface MailProvider {
  readonly kind: MailProviderKind;
  readonly capabilities: ProviderCapabilities;
  /** True when enough credentials/bindings exist to use the provider. */
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<SendResult>;

  /** Onboards a domain (creates it upstream, returns DNS records to add). */
  createDomain(name: string, context: DomainContext): Promise<ProviderDomainInfo>;
  /** Refreshes verification + DNS status. */
  getDomain(name: string, providerDomainId: string | null, context: DomainContext): Promise<ProviderDomainInfo>;
  /** Asks the provider to re-check DNS (no-op when unsupported). */
  verifyDomain(name: string, providerDomainId: string | null, context: DomainContext): Promise<ProviderDomainInfo>;
  deleteDomain(name: string, providerDomainId: string | null, context: DomainContext): Promise<void>;

  /** Parses and authenticates a webhook request. */
  handleWebhook?(request: Request): Promise<WebhookResult>;
  /** Fetches full content for events that only carried a reference. */
  fetchInbound?(fetchRef: string): Promise<{ raw?: Uint8Array; parsed?: ParsedMail }>;
}

export type DomainContext = {
  /** Public base URL of this deployment (for webhook URLs). */
  appBaseUrl: string;
  /** Worker name for Cloudflare routing rules. */
  workerName: string;
};

export function providerError(error: unknown, fallbackCode = 'provider_error'): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    const message = error instanceof Error ? error.message : code;
    const retryable = ['E_RATE_LIMIT_EXCEEDED', 'E_INTERNAL_SERVER_ERROR', 'E_DELIVERY_FAILED'].includes(code);
    return new ProviderError(retryable ? 502 : 400, code, message, retryable);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(502, fallbackCode, message, true);
}
