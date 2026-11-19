ALTER TABLE `github_connection` ADD `webhookTokenHash` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `webhookMasked` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `webhookDeliveries` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `webhookLastUsedAt` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `github_connection_webhookTokenHash_unique` ON `github_connection` (`webhookTokenHash`);