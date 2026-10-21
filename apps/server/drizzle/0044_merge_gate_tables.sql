CREATE TABLE `gate_digest` (
	`buildId` text NOT NULL,
	`headSha` text NOT NULL,
	`patchDigest` text NOT NULL,
	`countedFiles` integer NOT NULL,
	`countedLines` integer NOT NULL,
	`keptFiles` integer NOT NULL,
	`keptLines` integer NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`buildId`, `headSha`),
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gate_round` (
	`id` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`patchDigest` text NOT NULL,
	`round` integer NOT NULL,
	`fixRound` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`perspectives` text NOT NULL,
	`timedOut` text DEFAULT '[]' NOT NULL,
	`dispatches` text DEFAULT '{}' NOT NULL,
	`startedAt` integer NOT NULL,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gate_round_build_digest_unique` ON `gate_round` (`buildId`,`patchDigest`);--> statement-breakpoint
CREATE UNIQUE INDEX `gate_round_build_round_unique` ON `gate_round` (`buildId`,`round`);--> statement-breakpoint
CREATE TABLE `gate_state` (
	`buildId` text PRIMARY KEY NOT NULL,
	`ready` integer NOT NULL,
	`headSha` text,
	`patchDigest` text,
	`policy` text NOT NULL,
	`blockers` text NOT NULL,
	`evaluatedAt` integer NOT NULL,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gate_verdict` (
	`stepId` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`kind` text NOT NULL,
	`perspective` text,
	`outcome` text NOT NULL,
	`patchDigest` text,
	`headSha` text,
	`expectedHeadSha` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`stepId`) REFERENCES `step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gate_verdict_buildId_idx` ON `gate_verdict` (`buildId`);