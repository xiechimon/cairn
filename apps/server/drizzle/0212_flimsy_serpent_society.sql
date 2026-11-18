CREATE TABLE `antigravity_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`label` text NOT NULL,
	`tokenCipher` text,
	`expiresAt` integer,
	`enabledAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `antigravity_subscription_one_enabled` ON `antigravity_subscription` (`teamId`) WHERE "antigravity_subscription"."enabledAt" is not null;--> statement-breakpoint
ALTER TABLE `step` ADD `antigravitySubscriptionId` text;