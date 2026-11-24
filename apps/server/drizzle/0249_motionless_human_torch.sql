CREATE TABLE `pairing_request` (
	`id` text PRIMARY KEY NOT NULL,
	`secretHash` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`detail` text,
	`source` text NOT NULL,
	`peer` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`decidedAt` integer,
	`deviceId` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_request_secretHash_unique` ON `pairing_request` (`secretHash`);