CREATE TABLE `team_memory_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`line` text NOT NULL,
	`source` text,
	`sourceMessageId` text,
	`writtenAt` integer NOT NULL,
	`lastUsedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_memory_entry_line_idx` ON `team_memory_entry` (`teamId`,`line`);