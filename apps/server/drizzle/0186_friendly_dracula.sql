CREATE TABLE `devin_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`label` text NOT NULL,
	`tokenCipher` text NOT NULL,
	`expiresAt` integer,
	`enabledAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devin_subscription_one_enabled` ON `devin_subscription` (`teamId`) WHERE "devin_subscription"."enabledAt" is not null;--> statement-breakpoint
ALTER TABLE `step` ADD `devinSubscriptionId` text;