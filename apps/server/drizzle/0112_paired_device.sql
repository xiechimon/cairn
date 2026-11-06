CREATE TABLE `paired_device` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`masked` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastSeenAt` integer,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paired_device_tokenHash_unique` ON `paired_device` (`tokenHash`);