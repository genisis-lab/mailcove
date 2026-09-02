import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type {
  Address,
  ApiKeyScope,
  AuthResults,
  Category,
  DnsRecord,
  FilterActions,
  FilterCondition,
  ListUnsubscribe,
  MailProviderKind,
  MailboxPermission,
  MessageStatus,
  ThreadFolder,
  Vacation,
  WebhookEvent,
} from '../../shared/types';

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () => timestamp('created_at').default(nowMs).notNull();
const updatedAt = () =>
  timestamp('updated_at')
    .default(nowMs)
    .$onUpdate(() => new Date())
    .notNull();
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

// ---------------------------------------------------------------------------
// Authentication (managed by better-auth; shapes must match its expectations)
// ---------------------------------------------------------------------------

export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: bool('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  twoFactorEnabled: bool('two_factor_enabled').default(false),
  role: text('role'),
  banned: bool('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  locale: text('locale'),
  avatarKey: text('avatar_key'),
  prefs: text('prefs'),
  disabled: bool('disabled').default(false),
});

export const sessions = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
    deviceName: text('device_name'),
    lastSeenAt: timestamp('last_seen_at'),
  },
  (t) => [index('session_userId_idx').on(t.userId)],
);

export const accounts = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('account_userId_idx').on(t.userId), uniqueIndex('account_issuer_accountId_uq').on(t.issuer, t.accountId)],
);

export const verifications = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const twoFactors = sqliteTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: bool('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until'),
  },
  (t) => [index('twoFactor_secret_idx').on(t.secret), index('twoFactor_userId_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Domains and mailboxes
// ---------------------------------------------------------------------------

export const domains = sqliteTable(
  'domains',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    provider: text('provider').$type<MailProviderKind>().notNull(),
    providerDomainId: text('provider_domain_id'),
    zoneId: text('zone_id'),
    status: text('status').$type<'pending' | 'verified' | 'failed'>().notNull().default('pending'),
    sendingEnabled: bool('sending_enabled').notNull().default(false),
    receivingEnabled: bool('receiving_enabled').notNull().default(false),
    dnsRecords: json<DnsRecord[]>('dns_records'),
    catchallMailboxId: text('catchall_mailbox_id').references((): AnySQLiteColumn => mailboxes.id, {
      onDelete: 'set null',
    }),
    unknownRecipientPolicy: text('unknown_recipient_policy')
      .$type<'unrouted' | 'reject'>()
      .notNull()
      .default('unrouted'),
    lastCheckedAt: timestamp('last_checked_at'),
    verifiedAt: timestamp('verified_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('domains_name_uq').on(t.name)],
);

export const mailboxes = sqliteTable(
  'mailboxes',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    localPart: text('local_part').notNull(),
    address: text('address').notNull(),
    displayName: text('display_name'),
    type: text('type').$type<'personal' | 'shared'>().notNull().default('personal'),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    signatureHtml: text('signature_html'),
    vacation: json<Vacation>('vacation'),
    avatarKey: text('avatar_key'),
    disabled: bool('disabled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mailboxes_address_uq').on(t.address),
    uniqueIndex('mailboxes_domain_local_uq').on(t.domainId, t.localPart),
    index('mailboxes_owner_idx').on(t.ownerUserId),
  ],
);

export const mailboxAliases = sqliteTable(
  'mailbox_aliases',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mailbox_aliases_address_uq').on(t.address), index('mailbox_aliases_mailbox_idx').on(t.mailboxId)],
);

export const mailboxAccess = sqliteTable(
  'mailbox_access',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').$type<MailboxPermission>().notNull().default('full_access'),
    createdByUserId: text('created_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mailbox_access_uq').on(t.mailboxId, t.userId), index('mailbox_access_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Threads, messages, attachments
// ---------------------------------------------------------------------------

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull().default(''),
    subjectNorm: text('subject_norm').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    participants: json<Address[]>('participants').notNull().default(sql`'[]'`),
    folder: text('folder').$type<ThreadFolder>().notNull().default('inbox'),
    category: text('category').$type<Category>().notNull().default('primary'),
    snoozedUntil: timestamp('snoozed_until'),
    lastMessageAt: timestamp('last_message_at').notNull(),
    firstMessageAt: timestamp('first_message_at').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    starredCount: integer('starred_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    draftCount: integer('draft_count').notNull().default(0),
    scheduledCount: integer('scheduled_count').notNull().default(0),
    hasAttachments: bool('has_attachments').notNull().default(false),
    isImportant: bool('is_important').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('threads_mailbox_folder_last_idx').on(t.mailboxId, t.folder, t.lastMessageAt),
    index('threads_mailbox_last_idx').on(t.mailboxId, t.lastMessageAt),
    index('threads_mailbox_subject_idx').on(t.mailboxId, t.subjectNorm),
    index('threads_snoozed_idx').on(t.snoozedUntil),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    referencesHeader: text('references_header'),
    fromAddr: text('from_addr').notNull().default(''),
    fromName: text('from_name'),
    to: json<Address[]>('to_json').notNull().default(sql`'[]'`),
    cc: json<Address[]>('cc_json').notNull().default(sql`'[]'`),
    bcc: json<Address[]>('bcc_json').notNull().default(sql`'[]'`),
    replyTo: json<Address[]>('reply_to_json'),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    rawR2Key: text('raw_r2_key'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    hasAttachments: bool('has_attachments').notNull().default(false),
    isRead: bool('is_read').notNull().default(false),
    isStarred: bool('is_starred').notNull().default(false),
    isDraft: bool('is_draft').notNull().default(false),
    status: text('status').$type<MessageStatus>().notNull().default('received'),
    statusDetail: text('status_detail'),
    statusAt: timestamp('status_at'),
    trashedAt: timestamp('trashed_at'),
    scheduledAt: timestamp('scheduled_at'),
    sentAt: timestamp('sent_at'),
    receivedAt: timestamp('received_at').notNull(),
    authResults: json<AuthResults>('auth_results'),
    listUnsubscribe: json<ListUnsubscribe>('list_unsubscribe'),
    listId: text('list_id'),
    headers: json<Record<string, string>>('headers_json'),
    category: text('category').$type<Category>(),
    provider: text('provider').$type<MailProviderKind>(),
    providerMessageId: text('provider_message_id'),
    // draft-only metadata
    replyToMessageId: text('reply_to_message_id'),
    forwardOfMessageId: text('forward_of_message_id'),
    sendMode: text('send_mode').$type<'reply' | 'reply_all' | 'forward' | 'new'>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('messages_thread_idx').on(t.threadId, t.receivedAt),
    index('messages_mailbox_received_idx').on(t.mailboxId, t.receivedAt),
    index('messages_message_id_idx').on(t.mailboxId, t.messageId),
    index('messages_provider_idx').on(t.providerMessageId),
    index('messages_status_sched_idx').on(t.status, t.scheduledAt),
    index('messages_from_idx').on(t.mailboxId, t.fromAddr),
  ],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    uploadedByUserId: text('uploaded_by_user_id'),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    disposition: text('disposition').$type<'attachment' | 'inline'>().notNull().default('attachment'),
    contentId: text('content_id'),
    r2Key: text('r2_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_message_idx').on(t.messageId), index('attachments_uploader_idx').on(t.uploadedByUserId)],
);

// ---------------------------------------------------------------------------
// Organization: labels, filters, contacts, templates
// ---------------------------------------------------------------------------

export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#6366f1'),
    parentId: text('parent_id').references((): AnySQLiteColumn => labels.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    visibility: text('visibility').$type<'show' | 'hide' | 'show_if_unread'>().notNull().default('show'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('labels_user_name_uq').on(t.userId, t.name)],
);

export const threadLabels = sqliteTable(
  'thread_labels',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.labelId] }), index('thread_labels_label_idx').on(t.labelId)],
);

export const filters = sqliteTable(
  'filters',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mailboxId: text('mailbox_id').references(() => mailboxes.id, { onDelete: 'cascade' }),
    name: text('name'),
    matchType: text('match_type').$type<'all' | 'any'>().notNull().default('all'),
    conditions: json<FilterCondition[]>('conditions').notNull().default(sql`'[]'`),
    actions: json<FilterActions>('actions').notNull().default(sql`'{}'`),
    sortOrder: integer('sort_order').notNull().default(0),
    enabled: bool('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('filters_user_idx').on(t.userId, t.sortOrder)],
);

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    source: text('source').$type<'manual' | 'inbound' | 'outbound' | 'import'>().notNull().default('manual'),
    frequency: integer('frequency').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at'),
    notes: text('notes'),
    alwaysShowImages: bool('always_show_images').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('contacts_user_email_uq').on(t.userId, t.email), index('contacts_user_freq_idx').on(t.userId, t.frequency)],
);

export const blockedSenders = sqliteTable(
  'blocked_senders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('blocked_senders_uq').on(t.userId, t.pattern)],
);

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject'),
    bodyHtml: text('body_html').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('templates_user_idx').on(t.userId)],
);

export const autoReplyLog = sqliteTable(
  'auto_reply_log',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
    sentAt: timestamp('sent_at').notNull(),
  },
  (t) => [uniqueIndex('auto_reply_log_uq').on(t.mailboxId, t.recipient)],
);

// ---------------------------------------------------------------------------
// Integrations: API keys, webhooks, push
// ---------------------------------------------------------------------------

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: json<ApiKeyScope[]>('scopes').notNull().default(sql`'[]'`),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_keys_hash_uq').on(t.keyHash), index('api_keys_prefix_idx').on(t.prefix), index('api_keys_user_idx').on(t.userId)],
);

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: json<WebhookEvent[]>('events').notNull().default(sql`'[]'`),
    description: text('description'),
    enabled: bool('enabled').notNull().default(true),
    lastStatus: integer('last_status'),
    lastDeliveredAt: timestamp('last_delivered_at'),
    createdAt: createdAt(),
  },
  (t) => [index('webhooks_user_idx').on(t.userId)],
);

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: text('payload').notNull(),
    statusCode: integer('status_code'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(1),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt)],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Operations: audit, unrouted, provider state, settings, backups, dead letters
// ---------------------------------------------------------------------------

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: json<Record<string, unknown>>('metadata'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_actor_idx').on(t.actorUserId)],
);

export const unroutedMessages = sqliteTable(
  'unrouted_messages',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id').references(() => domains.id, { onDelete: 'set null' }),
    envelopeFrom: text('envelope_from').notNull().default(''),
    envelopeTo: text('envelope_to').notNull().default(''),
    subject: text('subject'),
    rawR2Key: text('raw_r2_key'),
    provider: text('provider').$type<MailProviderKind>(),
    providerMessageId: text('provider_message_id'),
    reason: text('reason').notNull().default('no_mailbox'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    resolvedAt: timestamp('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('unrouted_created_idx').on(t.createdAt)],
);

export const providerEvents = sqliteTable('provider_events', {
  id: text('id').primaryKey(),
  provider: text('provider').$type<MailProviderKind>().notNull(),
  type: text('type').notNull(),
  createdAt: createdAt(),
});

export const providerCredentials = sqliteTable('provider_credentials', {
  provider: text('provider').$type<MailProviderKind>().primaryKey(),
  encrypted: text('encrypted').notNull(),
  updatedByUserId: text('updated_by_user_id'),
  updatedAt: updatedAt(),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const deliveryEvents = sqliteTable(
  'delivery_events',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<MailProviderKind>().notNull(),
    type: text('type').notNull(),
    recipient: text('recipient'),
    detail: json<Record<string, unknown>>('detail'),
    occurredAt: timestamp('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('delivery_events_message_idx').on(t.messageId), index('delivery_events_created_idx').on(t.createdAt)],
);

export const backups = sqliteTable(
  'backups',
  {
    id: text('id').primaryKey(),
    status: text('status').$type<'running' | 'completed' | 'failed'>().notNull().default('running'),
    trigger: text('trigger').$type<'manual' | 'scheduled'>().notNull().default('manual'),
    r2Key: text('r2_key'),
    filename: text('filename'),
    sizeBytes: integer('size_bytes'),
    tableCounts: json<Record<string, number>>('table_counts'),
    error: text('error'),
    completedAt: timestamp('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('backups_created_idx').on(t.createdAt)],
);

export const deadLetters = sqliteTable(
  'dead_letters',
  {
    id: text('id').primaryKey(),
    queue: text('queue').notNull(),
    body: text('body').notNull(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    retriedAt: timestamp('retried_at'),
    createdAt: createdAt(),
  },
  (t) => [index('dead_letters_created_idx').on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Relations (for drizzle relational queries)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  twoFactors: many(twoFactors),
  mailboxes: many(mailboxes),
  labels: many(labels),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const twoFactorsRelations = relations(twoFactors, ({ one }) => ({
  user: one(users, { fields: [twoFactors.userId], references: [users.id] }),
}));

export const domainsRelations = relations(domains, ({ many }) => ({
  mailboxes: many(mailboxes),
}));

export const mailboxesRelations = relations(mailboxes, ({ one, many }) => ({
  domain: one(domains, { fields: [mailboxes.domainId], references: [domains.id] }),
  owner: one(users, { fields: [mailboxes.ownerUserId], references: [users.id] }),
  aliases: many(mailboxAliases),
  access: many(mailboxAccess),
}));

export const mailboxAliasesRelations = relations(mailboxAliases, ({ one }) => ({
  mailbox: one(mailboxes, { fields: [mailboxAliases.mailboxId], references: [mailboxes.id] }),
}));

export const mailboxAccessRelations = relations(mailboxAccess, ({ one }) => ({
  mailbox: one(mailboxes, { fields: [mailboxAccess.mailboxId], references: [mailboxes.id] }),
  user: one(users, { fields: [mailboxAccess.userId], references: [users.id] }),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  mailbox: one(mailboxes, { fields: [threads.mailboxId], references: [mailboxes.id] }),
  messages: many(messages),
  labels: many(threadLabels),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, { fields: [attachments.messageId], references: [messages.id] }),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
  user: one(users, { fields: [labels.userId], references: [users.id] }),
  threads: many(threadLabels),
}));

export const threadLabelsRelations = relations(threadLabels, ({ one }) => ({
  thread: one(threads, { fields: [threadLabels.threadId], references: [threads.id] }),
  label: one(labels, { fields: [threadLabels.labelId], references: [labels.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}));

// better-auth expects its model names as keys.
export const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  twoFactor: twoFactors,
};

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type MailboxAccessRow = typeof mailboxAccess.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Filter = typeof filters.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type UnroutedMessage = typeof unroutedMessages.$inferSelect;
export type Backup = typeof backups.$inferSelect;
export type DeadLetter = typeof deadLetters.$inferSelect;
