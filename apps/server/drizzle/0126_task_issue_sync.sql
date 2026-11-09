CREATE TABLE `task_issue_close` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`sourceRef` text NOT NULL,
	`comment` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `todo` ADD `issueState` text;--> statement-breakpoint
ALTER TABLE `todo` ADD `supersededBy` text;