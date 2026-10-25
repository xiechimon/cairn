CREATE TABLE `memory_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`agentId` text NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`buildIds` text NOT NULL,
	`evidence` text NOT NULL,
	`conflictIds` text DEFAULT '[]' NOT NULL,
	`memoryId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_candidate_scope_idx` ON `memory_candidate` (`agentId`,`teamId`,`projectId`);