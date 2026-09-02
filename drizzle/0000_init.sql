CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uq` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_uq` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_prefix_idx` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`uploaded_by_user_id` text,
	`filename` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`disposition` text DEFAULT 'attachment' NOT NULL,
	`content_id` text,
	`r2_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `attachments_uploader_idx` ON `attachments` (`uploaded_by_user_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `auto_reply_log` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`recipient` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auto_reply_log_uq` ON `auto_reply_log` (`mailbox_id`,`recipient`);--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`r2_key` text,
	`filename` text,
	`size_bytes` integer,
	`table_counts` text,
	`error` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `backups_created_idx` ON `backups` (`created_at`);--> statement-breakpoint
CREATE TABLE `blocked_senders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pattern` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocked_senders_uq` ON `blocked_senders` (`user_id`,`pattern`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`frequency` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer,
	`notes` text,
	`always_show_images` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_email_uq` ON `contacts` (`user_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_user_freq_idx` ON `contacts` (`user_id`,`frequency`);--> statement-breakpoint
CREATE TABLE `dead_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`queue` text NOT NULL,
	`body` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retried_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dead_letters_created_idx` ON `dead_letters` (`created_at`);--> statement-breakpoint
CREATE TABLE `delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`recipient` text,
	`detail` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delivery_events_message_idx` ON `delivery_events` (`message_id`);--> statement-breakpoint
CREATE INDEX `delivery_events_created_idx` ON `delivery_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`provider_domain_id` text,
	`zone_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`sending_enabled` integer DEFAULT false NOT NULL,
	`receiving_enabled` integer DEFAULT false NOT NULL,
	`dns_records` text,
	`catchall_mailbox_id` text,
	`unknown_recipient_policy` text DEFAULT 'unrouted' NOT NULL,
	`last_checked_at` integer,
	`verified_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`catchall_mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_name_uq` ON `domains` (`name`);--> statement-breakpoint
CREATE TABLE `filters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text,
	`name` text,
	`match_type` text DEFAULT 'all' NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`actions` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `filters_user_idx` ON `filters` (`user_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`parent_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'show' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_user_name_uq` ON `labels` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `mailbox_access` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text DEFAULT 'full_access' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_access_uq` ON `mailbox_access` (`mailbox_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `mailbox_access_user_idx` ON `mailbox_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `mailbox_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`address` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_aliases_address_uq` ON `mailbox_aliases` (`address`);--> statement-breakpoint
CREATE INDEX `mailbox_aliases_mailbox_idx` ON `mailbox_aliases` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`address` text NOT NULL,
	`display_name` text,
	`type` text DEFAULT 'personal' NOT NULL,
	`owner_user_id` text,
	`signature_html` text,
	`vacation` text,
	`avatar_key` text,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_address_uq` ON `mailboxes` (`address`);--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_domain_local_uq` ON `mailboxes` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `mailboxes_owner_idx` ON `mailboxes` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`references_header` text,
	`from_addr` text DEFAULT '' NOT NULL,
	`from_name` text,
	`to_json` text DEFAULT '[]' NOT NULL,
	`cc_json` text DEFAULT '[]' NOT NULL,
	`bcc_json` text DEFAULT '[]' NOT NULL,
	`reply_to_json` text,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`text_body` text,
	`html_body` text,
	`raw_r2_key` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`status_detail` text,
	`status_at` integer,
	`trashed_at` integer,
	`scheduled_at` integer,
	`sent_at` integer,
	`received_at` integer NOT NULL,
	`auth_results` text,
	`list_unsubscribe` text,
	`list_id` text,
	`headers_json` text,
	`category` text,
	`provider` text,
	`provider_message_id` text,
	`reply_to_message_id` text,
	`forward_of_message_id` text,
	`send_mode` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_mailbox_received_idx` ON `messages` (`mailbox_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `messages_message_id_idx` ON `messages` (`mailbox_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `messages_provider_idx` ON `messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `messages_status_sched_idx` ON `messages` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `messages_from_idx` ON `messages` (`mailbox_id`,`from_addr`);--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`updated_by_user_id` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_uq` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	`device_name` text,
	`last_seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`body_html` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `templates_user_idx` ON `templates` (`user_id`);--> statement-breakpoint
CREATE TABLE `thread_labels` (
	`thread_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`thread_id`, `label_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_labels_label_idx` ON `thread_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`subject_norm` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`participants` text DEFAULT '[]' NOT NULL,
	`folder` text DEFAULT 'inbox' NOT NULL,
	`category` text DEFAULT 'primary' NOT NULL,
	`snoozed_until` integer,
	`last_message_at` integer NOT NULL,
	`first_message_at` integer NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`starred_count` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`draft_count` integer DEFAULT 0 NOT NULL,
	`scheduled_count` integer DEFAULT 0 NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`is_important` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_mailbox_folder_last_idx` ON `threads` (`mailbox_id`,`folder`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `threads_mailbox_last_idx` ON `threads` (`mailbox_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `threads_mailbox_subject_idx` ON `threads` (`mailbox_id`,`subject_norm`);--> statement-breakpoint
CREATE INDEX `threads_snoozed_idx` ON `threads` (`snoozed_until`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `unrouted_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text,
	`envelope_from` text DEFAULT '' NOT NULL,
	`envelope_to` text DEFAULT '' NOT NULL,
	`subject` text,
	`raw_r2_key` text,
	`provider` text,
	`provider_message_id` text,
	`reason` text DEFAULT 'no_mailbox' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `unrouted_created_idx` ON `unrouted_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`two_factor_enabled` integer DEFAULT false,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`locale` text,
	`avatar_key` text,
	`prefs` text,
	`disabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status_code` integer,
	`error` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_status` integer,
	`last_delivered_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_user_idx` ON `webhooks` (`user_id`);