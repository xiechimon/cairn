CREATE TABLE `github_connection` (
	`teamId` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`accessTokenCipher` text NOT NULL,
	`scope` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `project` ADD `localPath` text;