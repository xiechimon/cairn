CREATE TABLE `chief_report` (
	`id` text PRIMARY KEY NOT NULL,
	`chiefId` text NOT NULL,
	`teamId` text NOT NULL,
	`day` text NOT NULL,
	`threadId` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`stepId` text,
	`inputs` text,
	`pushedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chief_report_chief_day_unique` ON `chief_report` (`chiefId`,`day`);--> statement-breakpoint
CREATE TABLE `retro_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`reportId` text NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text NOT NULL,
	`title` text NOT NULL,
	`what` text NOT NULL,
	`why` text NOT NULL,
	`safeguard` text NOT NULL,
	`sourceKind` text NOT NULL,
	`sourceId` text NOT NULL,
	`sourceLabel` text NOT NULL,
	`sourceTodoId` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`todoId` text,
	`decidedAt` integer,
	`decidedBy` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `retro_proposal_report_idx` ON `retro_proposal` (`reportId`);