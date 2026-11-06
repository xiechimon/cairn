CREATE TABLE `step_route` (
	`stepId` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`kind` text NOT NULL,
	`difficulty` text NOT NULL,
	`harness` text,
	`provider` text,
	`modelId` text,
	`machineId` text,
	`reason` text NOT NULL,
	`rejected` text NOT NULL,
	`decidedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `step_route_team_decided_idx` ON `step_route` (`teamId`,`decidedAt`);