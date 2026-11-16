CREATE TABLE `step_usage` (
	`stepId` text NOT NULL,
	`model` text NOT NULL,
	`teamId` text NOT NULL,
	`buildId` text NOT NULL,
	`kind` text NOT NULL,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheWrite` integer DEFAULT 0 NOT NULL,
	`mirroredTokens` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`stepId`, `model`)
);
--> statement-breakpoint
CREATE INDEX `step_usage_team_created_idx` ON `step_usage` (`teamId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `step_usage_build_model_idx` ON `step_usage` (`buildId`,`model`);