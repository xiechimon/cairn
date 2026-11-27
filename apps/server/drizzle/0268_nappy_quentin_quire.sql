ALTER TABLE `machine` ADD `pendingTokenHash` text;--> statement-breakpoint
ALTER TABLE `machine` ADD `tokenReauthRequired` integer DEFAULT false NOT NULL;