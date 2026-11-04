CREATE TABLE `autonomy_state` (
	`projectId` text NOT NULL,
	`kind` text NOT NULL,
	`lastStartedAt` integer,
	`baselineSha` text,
	`lastBlockedReason` text,
	`lastEvaluatedAt` integer,
	PRIMARY KEY(`projectId`, `kind`),
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member_activity` (
	`scope` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `project` ADD `autonomy` text;