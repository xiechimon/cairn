CREATE TABLE `thread_pr` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`threadId` text NOT NULL,
	`buildId` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`mergeState` text DEFAULT 'unknown' NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`checksPassed` integer DEFAULT 0 NOT NULL,
	`checksFailed` integer DEFAULT 0 NOT NULL,
	`checksRunning` integer DEFAULT 0 NOT NULL,
	`checksTotal` integer DEFAULT 0 NOT NULL,
	`head` text DEFAULT '' NOT NULL,
	`verdictResult` text,
	`verdictHead` text,
	`autoFix` integer DEFAULT true NOT NULL,
	`mergeWhenReady` integer DEFAULT false NOT NULL,
	`autoArchive` integer DEFAULT true NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`blockedSince` integer,
	`wakeRounds` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`threadId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_pr_build_unique` ON `thread_pr` (`buildId`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_pr_team_repo_number_unique` ON `thread_pr` (`teamId`,`repo`,`number`);--> statement-breakpoint
CREATE INDEX `thread_pr_threadId_idx` ON `thread_pr` (`threadId`);