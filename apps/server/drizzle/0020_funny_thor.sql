CREATE TABLE `shell_command` (
	`id` text PRIMARY KEY NOT NULL,
	`stepId` text NOT NULL,
	`machineId` text NOT NULL,
	`agentId` text NOT NULL,
	`teamId` text NOT NULL,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`exitCode` integer,
	`output` text,
	`errorMessage` text,
	`createdAt` integer NOT NULL,
	`finishedAt` integer
);
--> statement-breakpoint
ALTER TABLE `machine` ADD `shellEnabled` integer DEFAULT false NOT NULL;