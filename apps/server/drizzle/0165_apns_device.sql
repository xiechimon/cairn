CREATE TABLE `apns_device` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`teamId` text NOT NULL,
	`token` text NOT NULL,
	`environment` text NOT NULL,
	`pairedDeviceId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apns_device_token_unique` ON `apns_device` (`token`);