CREATE TABLE `harness_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`mode` text DEFAULT 'independent' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`targets` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harness_profile_team_unique` ON `harness_profile` (`teamId`);