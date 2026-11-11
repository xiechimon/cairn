CREATE TABLE `hosted_cleanup_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text NOT NULL,
	`repoName` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`nextAttemptAt` integer NOT NULL,
	`lastError` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosted_cleanup_unresolved_idx` ON `hosted_cleanup_outbox` (`teamId`,`repoName`) WHERE "hosted_cleanup_outbox"."state" != 'done';