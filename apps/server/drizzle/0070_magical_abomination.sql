CREATE TABLE `autonomous_merge_admission` (
	`buildId` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`state` text NOT NULL,
	`createdAt` integer NOT NULL,
	`landedAt` integer
);
--> statement-breakpoint
CREATE INDEX `autonomous_merge_team_state_landed_idx` ON `autonomous_merge_admission` (`teamId`,`state`,`landedAt`);--> statement-breakpoint
CREATE INDEX `autonomous_merge_pending_age_idx` ON `autonomous_merge_admission` (`state`,`createdAt`);--> statement-breakpoint
ALTER TABLE `team` ADD `maxAutonomousMergesPerDay` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
CREATE INDEX `message_createdAt_idx` ON `message` (`createdAt`);--> statement-breakpoint
CREATE INDEX `step_merge_finished_idx` ON `step` (`kind`,`status`,`finishedAt`);