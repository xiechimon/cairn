CREATE TABLE `memory_edit` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`chiefId` text NOT NULL,
	`threadId` text NOT NULL,
	`stepId` text,
	`instruction` text NOT NULL,
	`file` text,
	`projectId` text,
	`status` text DEFAULT 'working' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`reply` text,
	`failureReason` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_edit_team_idx` ON `memory_edit` (`teamId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `memory_edit_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`editId` text NOT NULL,
	`callId` text NOT NULL,
	`tool` text NOT NULL,
	`scope` text,
	`file` text,
	`beforeVersion` text,
	`afterVersion` text,
	`summary` text NOT NULL,
	`result` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`editId`) REFERENCES `memory_edit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_edit_receipt_call_unique` ON `memory_edit_receipt` (`editId`,`callId`);--> statement-breakpoint
CREATE INDEX `memory_edit_receipt_edit_idx` ON `memory_edit_receipt` (`editId`,`createdAt`);--> statement-breakpoint
DROP INDEX `chief_thread_coordinator_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `chief_thread_coordinator_unique` ON `chief_thread` (`chiefId`) WHERE "chief_thread"."archivedAt" is null and "chief_thread"."projectId" is null and "chief_thread"."id" not like 'chief-digest-%' and "chief_thread"."id" not like 'chief-memory-%';