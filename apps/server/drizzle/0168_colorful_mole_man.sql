CREATE TABLE `team_top_models` (
	`teamId` text PRIMARY KEY NOT NULL,
	`models` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
