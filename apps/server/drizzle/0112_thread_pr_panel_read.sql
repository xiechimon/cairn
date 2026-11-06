ALTER TABLE `thread_pr` ADD `checksFailedNames` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `thread_pr` ADD `headRef` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `thread_pr` ADD `baseRef` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `thread_pr` ADD `lastReadAt` integer DEFAULT 0 NOT NULL;