CREATE TABLE `schedule_report` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`generatedAt` integer NOT NULL,
	`mainSha` text NOT NULL,
	`groups` text NOT NULL,
	`items` text NOT NULL,
	`unparsedDeps` text NOT NULL,
	`decidedAt` integer,
	`decidedBy` text,
	`appliedAt` integer,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedule_report_project_idx` ON `schedule_report` (`projectId`,`generatedAt`);