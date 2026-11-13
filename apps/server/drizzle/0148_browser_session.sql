CREATE TABLE `pairing_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`codeHash` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`revokedAt` integer,
	`redeemedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_grant_codeHash_unique` ON `pairing_grant` (`codeHash`);
--> statement-breakpoint
CREATE TABLE `browser_session` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenHash` text NOT NULL,
	`kind` text NOT NULL,
	`deviceId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`deviceId`) REFERENCES `paired_device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_session_tokenHash_unique` ON `browser_session` (`tokenHash`);
