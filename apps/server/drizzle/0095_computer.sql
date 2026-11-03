CREATE TABLE `computer` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`scope` text DEFAULT 'private' NOT NULL,
	`scopeKey` text NOT NULL,
	`machineId` text NOT NULL,
	`kind` text DEFAULT 'orb' NOT NULL,
	`providerRef` text NOT NULL,
	`state` text DEFAULT 'stopped' NOT NULL,
	`runningSince` integer,
	`executionStepId` text,
	`executionLeaseExpiresAt` integer,
	`executionFence` integer DEFAULT 0 NOT NULL,
	`controlHolder` text DEFAULT 'none' NOT NULL,
	`controlLeaseId` text,
	`controlLeaseExpiresAt` integer,
	`controlFence` integer DEFAULT 0 NOT NULL,
	`screenGeneration` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machineId`) REFERENCES `machine`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `computer_scope_key_idx` ON `computer` (`scopeKey`);--> statement-breakpoint
CREATE TABLE `computer_call` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`stepId` text NOT NULL,
	`toolCallId` text NOT NULL,
	`machineId` text NOT NULL,
	`computerId` text,
	`tool` text NOT NULL,
	`replaySafe` integer NOT NULL,
	`params` text NOT NULL,
	`state` text DEFAULT 'dispatched' NOT NULL,
	`lastSeq` integer DEFAULT 0 NOT NULL,
	`outputHead` text DEFAULT '' NOT NULL,
	`outputTail` text DEFAULT '' NOT NULL,
	`outputChars` integer DEFAULT 0 NOT NULL,
	`resultText` text,
	`resultImages` text,
	`exitCode` integer,
	`errorMessage` text,
	`errorDelivery` text,
	`deadlineAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`startedAt` integer,
	`finishedAt` integer,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machineId`) REFERENCES `machine`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`computerId`) REFERENCES `computer`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `computer_call_step_idx` ON `computer_call` (`stepId`);--> statement-breakpoint
CREATE INDEX `computer_call_machine_state_idx` ON `computer_call` (`machineId`,`state`);