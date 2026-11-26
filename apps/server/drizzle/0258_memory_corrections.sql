CREATE TABLE `memory_correction` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text,
	`pointedFile` text,
	`pointedRule` text,
	`inTurnIndex` integer,
	`buildId` text NOT NULL,
	`stepId` text NOT NULL,
	`ownerMessageId` text NOT NULL,
	`ownerWords` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_correction_exchange_idx` ON `memory_correction` (`teamId`,`ownerMessageId`);--> statement-breakpoint
CREATE INDEX `memory_correction_team_created_idx` ON `memory_correction` (`teamId`,`createdAt`);