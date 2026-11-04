CREATE TABLE `build_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`kind` text NOT NULL,
	`side` text NOT NULL,
	`feedback` text NOT NULL,
	`actor` text NOT NULL,
	`stepId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `build_feedback_buildId_idx` ON `build_feedback` (`buildId`);--> statement-breakpoint
ALTER TABLE `build` ADD `baseSha` text;--> statement-breakpoint
ALTER TABLE `build` ADD `harnessHash` text;