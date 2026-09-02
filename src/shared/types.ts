// Shared domain types used by both the Worker and the SPA.

export const MAIL_PROVIDERS = ['cloudflare', 'resend', 'postmark', 'sendgrid', 'mailgun'] as const;
export type MailProviderKind = (typeof MAIL_PROVIDERS)[number];

export const THREAD_FOLDERS = ['inbox', 'archive', 'spam', 'trash'] as const;
export type ThreadFolder = (typeof THREAD_FOLDERS)[number];

export const MESSAGE_STATUSES = [
  'received',
  'draft',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'delayed',
  'bounced',
  'complained',
  'failed',
  'cancelled',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const CATEGORIES = ['primary', 'social', 'promotions', 'updates', 'forums'] as const;
export type Category = (typeof CATEGORIES)[number];

export const MAILBOX_PERMISSIONS = ['read_only', 'send_as', 'full_access'] as const;
export type MailboxPermission = (typeof MAILBOX_PERMISSIONS)[number];

export const VIEWS = [
  'inbox',
  'starred',
  'snoozed',
  'sent',
  'drafts',
  'scheduled',
  'all',
  'spam',
  'trash',
  'label',
  'search',
] as const;
export type MailView = (typeof VIEWS)[number];

export type Address = { name?: string | null; email: string };

export type AuthResults = {
  spf?: string | null;
  dkim?: string | null;
  dmarc?: string | null;
};

export type ListUnsubscribe = {
  http?: string | null;
  mailto?: string | null;
  oneClick?: boolean;
};

export type Vacation = {
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  startsAt?: string | null;
  endsAt?: string | null;
  contactsOnly?: boolean;
};

export type DnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number | null;
  ttl?: string | number | null;
  status?: 'pending' | 'verified' | 'failed' | 'unknown';
  purpose?: string;
};

export type FilterConditionField =
  | 'from'
  | 'to'
  | 'subject'
  | 'body'
  | 'has_attachment'
  | 'size_gt'
  | 'size_lt'
  | 'list_id'
  | 'header';

export type FilterOperator = 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with' | 'matches';

export type FilterCondition = {
  field: FilterConditionField;
  operator?: FilterOperator;
  value?: string;
  header?: string;
};

export type FilterActions = {
  skipInbox?: boolean;
  markRead?: boolean;
  star?: boolean;
  labelIds?: string[];
  forwardTo?: string;
  markSpam?: boolean;
  neverSpam?: boolean;
  trash?: boolean;
  category?: Category;
  markImportant?: boolean;
};

export type UserPrefs = {
  density?: 'default' | 'comfortable' | 'compact';
  readingPane?: 'right' | 'bottom' | 'off';
  theme?: 'light' | 'dark' | 'system';
  undoSendSeconds?: number;
  keyboardShortcuts?: boolean;
  conversationView?: boolean;
  categoryTabs?: boolean;
  showImages?: 'always' | 'ask';
  pageSize?: number;
  defaultMailboxId?: string | null;
  signatureOnReply?: boolean;
  desktopNotifications?: boolean;
  soundOnNewMail?: boolean;
};

export type ApiKeyScope = 'mail:read' | 'mail:send' | 'mail:write' | 'contacts:read' | 'admin';

export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.bounced',
  'message.complained',
  'message.failed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type RealtimeEvent =
  | { type: 'message.new'; threadId: string; mailboxId: string; messageId: string; from: Address; subject: string }
  | { type: 'thread.updated'; threadId: string; mailboxId: string }
  | { type: 'message.status'; messageId: string; threadId: string; status: MessageStatus }
  | { type: 'counts.changed' }
  | { type: 'pong' };
