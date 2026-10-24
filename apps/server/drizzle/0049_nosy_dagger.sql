CREATE TABLE `memory_save_conflict` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agent_memory` ADD `history` text DEFAULT '[]' NOT NULL;