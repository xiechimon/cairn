CREATE TABLE `chief_turn_usage` (
	`stepId` text NOT NULL,
	`threadId` text NOT NULL,
	`model` text NOT NULL,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheWrite` integer DEFAULT 0 NOT NULL,
	`ttftMs` integer,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`stepId`, `model`)
);
--> statement-breakpoint
CREATE INDEX `chief_turn_usage_thread_idx` ON `chief_turn_usage` (`threadId`,`createdAt`);