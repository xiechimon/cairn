CREATE TABLE `autonomy_pause` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`markers` text NOT NULL,
	`publishError` text,
	`openedAt` integer NOT NULL,
	`resolvedAt` integer,
	`resolvedBy` text,
	`requestKey` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `autonomy_pause_team_resolved_idx` ON `autonomy_pause` (`teamId`,`resolvedAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `autonomy_pause_team_request_key_idx` ON `autonomy_pause` (`teamId`,`requestKey`);--> statement-breakpoint
INSERT INTO `autonomy_pause` (`id`, `teamId`, `source`, `reason`, `markers`, `publishError`, `openedAt`) SELECT 'legacy-' || `id`, `id`, 'legacy', 'legacy pause (no marker)', '[]', 'legacy pause (no marker)', CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `team` WHERE `autonomyPaused` = 1;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `autonomyPaused`;