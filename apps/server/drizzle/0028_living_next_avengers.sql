ALTER TABLE `token_usage` ADD `costInput` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `token_usage` ADD `costOutput` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `token_usage` ADD `costCacheRead` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `token_usage` ADD `costCacheWrite` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `token_usage` ADD `costTotal` real DEFAULT 0 NOT NULL;