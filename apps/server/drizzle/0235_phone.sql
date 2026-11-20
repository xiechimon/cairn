CREATE TABLE `phone` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`machineId` text NOT NULL,
	`platform` text NOT NULL,
	`deviceId` text NOT NULL,
	`name` text NOT NULL,
	`consentAt` integer,
	`consentedBy` text,
	`lastError` text,
	`executionStepId` text,
	`executionLeaseExpiresAt` integer,
	`executionFence` integer DEFAULT 0 NOT NULL,
	`handoffReason` text,
	`handoffStepId` text,
	`handoffRequestedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machineId`) REFERENCES `machine`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `phone_team_idx` ON `phone` (`teamId`);--> statement-breakpoint
CREATE UNIQUE INDEX `phone_machine_device_idx` ON `phone` (`machineId`,`deviceId`);--> statement-breakpoint
ALTER TABLE `computer_call` ADD `phoneId` text REFERENCES phone(id) ON DELETE set null;