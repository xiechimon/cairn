CREATE TABLE `chief` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`teamId` text NOT NULL,
	`agentId` text,
	`thinkingLevel` text,
	`charter` text DEFAULT '' NOT NULL,
	`watches` text DEFAULT '[]' NOT NULL,
	`wakes` text DEFAULT '[]' NOT NULL,
	`lastTurnAt` integer,
	`createdAt` integer NOT NULL,
	`tz` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_step` (
	`id` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`kind` text NOT NULL,
	`machineId` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`sessionId` text,
	`checkpointCommit` text,
	`claimedAt` integer,
	`lastHeartbeatAt` integer,
	`prompt` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_step`("id", "buildId", "kind", "machineId", "status", "sessionId", "checkpointCommit", "claimedAt", "lastHeartbeatAt", "prompt", "createdAt") SELECT "id", "buildId", "kind", "machineId", "status", "sessionId", "checkpointCommit", "claimedAt", "lastHeartbeatAt", NULL, "createdAt" FROM `step`;--> statement-breakpoint
DROP TABLE `step`;--> statement-breakpoint
ALTER TABLE `__new_step` RENAME TO `step`;--> statement-breakpoint
PRAGMA foreign_keys=ON;