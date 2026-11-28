CREATE TABLE `memory_consolidation` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`agentId` text NOT NULL,
	`projectId` text,
	`status` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`provider` text,
	`modelId` text,
	`edits` text DEFAULT '[]' NOT NULL,
	`dropFiles` text DEFAULT '[]' NOT NULL,
	`beforeText` text DEFAULT '' NOT NULL,
	`afterText` text DEFAULT '' NOT NULL,
	`startedAt` integer NOT NULL,
	`finishedAt` integer NOT NULL,
	`undoneAt` integer
);
--> statement-breakpoint
CREATE INDEX `memory_consolidation_scope_idx` ON `memory_consolidation` (`teamId`,`projectId`,`startedAt`);