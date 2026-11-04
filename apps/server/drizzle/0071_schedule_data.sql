ALTER TABLE `schedule` ADD `cron` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `prompt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule` ADD `lastRunAt` integer;--> statement-breakpoint
ALTER TABLE `schedule` ADD `lastRunStatus` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `pausedReason` text;--> statement-breakpoint
DELETE FROM `schedule` WHERE rowid NOT IN (SELECT MAX(rowid) FROM `schedule` GROUP BY `todoId`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_todoId_unique` ON `schedule` (`todoId`);
