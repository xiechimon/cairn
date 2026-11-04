CREATE TABLE `branch_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`machineId` text NOT NULL,
	`teamId` text NOT NULL,
	`directory` text NOT NULL,
	`ref` text NOT NULL,
	`commit` text NOT NULL,
	`force` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`errorMessage` text,
	`createdAt` integer NOT NULL,
	`startedAt` integer,
	`finishedAt` integer,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machineId`) REFERENCES `machine`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
