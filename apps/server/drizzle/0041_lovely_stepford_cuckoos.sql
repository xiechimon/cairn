CREATE TABLE `webhook_token` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text,
	`tokenHash` text NOT NULL,
	`masked` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_token_tokenHash_unique` ON `webhook_token` (`tokenHash`);