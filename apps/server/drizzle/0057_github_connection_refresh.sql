ALTER TABLE `github_connection` ADD `refreshTokenCipher` text;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `accessTokenExpiresAt` integer;--> statement-breakpoint
ALTER TABLE `github_connection` ADD `disconnectedReason` text;