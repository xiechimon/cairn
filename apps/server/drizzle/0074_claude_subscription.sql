CREATE TABLE `claude_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`label` text NOT NULL,
	`tokenCipher` text NOT NULL,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
