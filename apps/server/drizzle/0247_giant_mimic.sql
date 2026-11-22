CREATE TABLE `notice_mark` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`condition` text NOT NULL,
	`subjectId` text NOT NULL,
	`fingerprint` text NOT NULL,
	`notedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notice_mark_userId_condition_idx` ON `notice_mark` (`userId`,`condition`);--> statement-breakpoint
INSERT INTO `notice_mark` (`id`, `userId`, `condition`, `subjectId`, `fingerprint`, `notedAt`) SELECT `userId` || ':watchdog_flag:' || `entityId`, `userId`, 'watchdog_flag', `entityId`, `snippet`, `createdAt` FROM `notification` WHERE `type` = 'watchdog_flag' AND `snippet` IS NOT NULL;
