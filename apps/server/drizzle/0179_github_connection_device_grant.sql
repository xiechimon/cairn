ALTER TABLE `github_connection` ADD `refreshTokenExpiresAt` integer;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `appClientId` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `connectionGeneration` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `refreshLeaseUntil` integer;