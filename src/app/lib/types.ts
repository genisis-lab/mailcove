import type {
  Address,
  AuthResults,
  Category,
  FilterActions,
  FilterCondition,
  ListUnsubscribe,
  MailProviderKind,
  MailboxPermission,
  MessageStatus,
  ThreadFolder,
  UserPrefs,
  Vacation,
} from '@shared/types';

export type Me = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string | null;
    isAdmin: boolean;
    twoFactorEnabled: boolean;
    avatarUrl: string | null;
    locale: string;
    prefs: UserPrefs;
    createdAt: string;
  };
  mailboxes: MailboxSummary[];
  labels: Label[];
  counts: ViewCounts;
  settings: {
    appName: string;
    accentColor: string;
    logoUrl: string | null;
    defaultUndoSendSeconds: number;
    maxAttachmentBytes: number;
    maxMessageBytes: number;
    pushAvailable: boolean;
    publicApiEnabled: boolean;
    inboundCategorization: boolean;
  };
};

export type MailboxSummary = {
  id: string;
  address: string;
  displayName: string | null;
  type: 'personal' | 'shared';
  domain: string;
  permission: MailboxPermission;
  isOwner: boolean;
  signatureHtml: string | null;
  vacation: Vacation | null;
  disabled: boolean;
  aliases?: string[];
  avatarUrl: string | null;
};

export type Label = {
  id: string;
  userId: string;
  name: string;
  color: string;
  parentId: string | null;
  sortOrder: number;
  visibility: 'show' | 'hide' | 'show_if_unread';
  createdAt: string;
};

export type ViewCounts = {
  inbox: number;
  inboxUnread: number;
  starred: number;
  snoozed: number;
  drafts: number;
  scheduled: number;
  spam: number;
  spamUnread: number;
  trash: number;
  labels: Record<string, { total: number; unread: number }>;
  categories: Record<Category, number>;
};

export type AttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  disposition?: 'attachment' | 'inline';
  contentId?: string | null;
  url?: string;
};

export type ThreadItem = {
  id: string;
  mailboxId: string;
  mailboxAddress: string;
  subject: string;
  snippet: string;
  participants: Address[];
  folder: ThreadFolder;
  category: Category;
  snoozedUntil: string | null;
  lastMessageAt: string;
  firstMessageAt: string;
  messageCount: number;
  unreadCount: number;
  starredCount: number;
  sentCount: number;
  draftCount: number;
  scheduledCount: number;
  hasAttachments: boolean;
  isImportant: boolean;
  labels: Array<Pick<Label, 'id' | 'name' | 'color'>>;
  lastFrom: Address | null;
  lastDirection: 'inbound' | 'outbound' | null;
  attachments: AttachmentMeta[];
};

export type Message = {
  id: string;
  threadId: string;
  mailboxId: string;
  direction: 'inbound' | 'outbound';
  messageId: string | null;
  inReplyTo: string | null;
  fromAddr: string;
  fromName: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[] | null;
  subject: string;
  snippet: string;
  textBody: string | null;
  htmlBody: string | null;
  sizeBytes: number;
  hasAttachments: boolean;
  isRead: boolean;
  isStarred: boolean;
  isDraft: boolean;
  status: MessageStatus;
  statusDetail: string | null;
  statusAt: string | null;
  trashedAt: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  receivedAt: string;
  authResults: AuthResults | null;
  listUnsubscribe: ListUnsubscribe | null;
  listId: string | null;
  headers: Record<string, string> | null;
  category: Category | null;
  provider: MailProviderKind | null;
  replyToMessageId: string | null;
  forwardOfMessageId: string | null;
  sendMode: 'reply' | 'reply_all' | 'forward' | 'new' | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentMeta[];
};

export type ThreadDetail = {
  thread: ThreadItem & { labels: Array<Pick<Label, 'id' | 'name' | 'color'>> };
  messages: Message[];
};

export type Filter = {
  id: string;
  userId: string;
  mailboxId: string | null;
  name: string | null;
  matchType: 'all' | 'any';
  conditions: FilterCondition[];
  actions: FilterActions;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
};

export type Contact = {
  id: string;
  email: string;
  name: string | null;
  source: string;
  frequency: number;
  lastSeenAt: string | null;
  notes: string | null;
  alwaysShowImages: boolean;
};

export type Template = { id: string; name: string; subject: string | null; bodyHtml: string; updatedAt: string };

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type Session = {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export type AppConfig = {
  appName: string;
  logoUrl: string | null;
  accentColor: string;
  allowSignups: boolean;
  needsSetup: boolean;
  hasUsers: boolean;
  pushPublicKey: string | null;
  turnstileSiteKey: string | null;
  baseUrl: string;
  version: string;
};

export type ComposePayload = {
  mailboxId: string;
  fromAddress?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string | null;
  text?: string | null;
  uploadIds: string[];
  replyToMessageId?: string | null;
  forwardOfMessageId?: string | null;
  includeOriginalAttachments?: boolean;
  sendMode?: 'reply' | 'reply_all' | 'forward' | 'new';
  scheduledAt?: string | null;
  draftId?: string | null;
};
