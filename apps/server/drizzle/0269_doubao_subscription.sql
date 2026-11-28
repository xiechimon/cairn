CREATE TABLE `doubao_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`label` text NOT NULL,
	`runnerId` text,
	`enabledAt` integer,
	`models` text DEFAULT '[]' NOT NULL,
	`lastCheck` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doubao_subscription_team_idx` ON `doubao_subscription` (`teamId`);--> statement-breakpoint
CREATE UNIQUE INDEX `doubao_subscription_one_enabled` ON `doubao_subscription` (`teamId`) WHERE "doubao_subscription"."enabledAt" is not null;--> statement-breakpoint
ALTER TABLE `step` ADD `doubaoSubscriptionId` text;