ALTER TABLE `tag` ADD `color` text DEFAULT '#6366f1' NOT NULL;--> statement-breakpoint
ALTER TABLE `tag` ADD `createdAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tag` ADD `v` integer DEFAULT 1 NOT NULL;