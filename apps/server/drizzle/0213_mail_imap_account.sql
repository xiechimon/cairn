ALTER TABLE `mail_account` ADD `address` text;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `imapHost` text;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `imapPort` integer;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `smtpHost` text;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `smtpPort` integer;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `defaultRank` text DEFAULT 'can_wait' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `lastMailAt` integer;--> statement-breakpoint
ALTER TABLE `mail_account` ADD `lastError` text;--> statement-breakpoint
ALTER TABLE `mail_event` ADD `messageId` text;--> statement-breakpoint
CREATE INDEX `mail_event_account_message_idx` ON `mail_event` (`accountId`,`messageId`);