CREATE TABLE `action_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`actionId` text NOT NULL,
	`targetId` text NOT NULL,
	`actor` text NOT NULL,
	`surface` text NOT NULL,
	`kind` text NOT NULL,
	`inputHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "action_journal_actor" CHECK("action_journal"."actor" in ('user', 'coordinator')),
	CONSTRAINT "action_journal_kind" CHECK("action_journal"."kind" in ('run', 'undo', 'undo-refused', 'error'))
);
--> statement-breakpoint
CREATE INDEX `action_journal_team_idx` ON `action_journal` (`teamId`,`createdAt`);