PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_im_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`platform` text NOT NULL,
	`accountLabel` text,
	`secretCipher` text NOT NULL,
	`pairedSenders` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`statusDetail` text,
	`pollOffset` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "im_connection_platform" CHECK("__new_im_connection"."platform" in ('telegram', 'wechat', 'slack', 'imessage')),
	CONSTRAINT "im_connection_status" CHECK("__new_im_connection"."status" in ('connecting', 'ready', 'degraded', 'expired', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_im_connection`("id", "teamId", "userId", "platform", "accountLabel", "secretCipher", "pairedSenders", "status", "statusDetail", "pollOffset", "createdAt", "updatedAt") SELECT "id", "teamId", "userId", "platform", "accountLabel", "secretCipher", "pairedSenders", "status", "statusDetail", "pollOffset", "createdAt", "updatedAt" FROM `im_connection`;--> statement-breakpoint
DROP TABLE `im_connection`;--> statement-breakpoint
ALTER TABLE `__new_im_connection` RENAME TO `im_connection`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `im_connection_team_idx` ON `im_connection` (`teamId`);