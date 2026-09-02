-- Full-text search over messages. Hand-written: drizzle-kit does not model
-- virtual tables. The FTS rowid mirrors messages.rowid so lookups and deletes
-- stay O(log n).
CREATE VIRTUAL TABLE IF NOT EXISTS `messages_fts` USING fts5(
  `subject`,
  `from_text`,
  `to_text`,
  `body`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `messages_fts`(`rowid`, `subject`, `from_text`, `to_text`, `body`)
  VALUES (
    new.rowid,
    new.subject,
    coalesce(new.from_name, '') || ' ' || new.from_addr,
    coalesce(new.to_json, '') || ' ' || coalesce(new.cc_json, '') || ' ' || coalesce(new.bcc_json, ''),
    substr(coalesce(new.text_body, ''), 1, 65536)
  );
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
  DELETE FROM `messages_fts` WHERE `rowid` = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `messages_fts_au` AFTER UPDATE OF `subject`, `from_addr`, `from_name`, `to_json`, `cc_json`, `bcc_json`, `text_body` ON `messages` BEGIN
  DELETE FROM `messages_fts` WHERE `rowid` = old.rowid;
  INSERT INTO `messages_fts`(`rowid`, `subject`, `from_text`, `to_text`, `body`)
  VALUES (
    new.rowid,
    new.subject,
    coalesce(new.from_name, '') || ' ' || new.from_addr,
    coalesce(new.to_json, '') || ' ' || coalesce(new.cc_json, '') || ' ' || coalesce(new.bcc_json, ''),
    substr(coalesce(new.text_body, ''), 1, 65536)
  );
END;
