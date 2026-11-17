CREATE TABLE `im_connection` (
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
	CONSTRAINT "im_connection_platform" CHECK("im_connection"."platform" in ('telegram', 'wechat')),
	CONSTRAINT "im_connection_status" CHECK("im_connection"."status" in ('connecting', 'ready', 'degraded', 'expired', 'error'))
);
--> statement-breakpoint
CREATE INDEX `im_connection_team_idx` ON `im_connection` (`teamId`);--> statement-breakpoint
CREATE TABLE `im_pairing_request` (
	`id` text PRIMARY KEY NOT NULL,
	`connId` text NOT NULL,
	`senderId` text NOT NULL,
	`senderName` text,
	`chatKey` text NOT NULL,
	`status` text NOT NULL,
	`requestedAt` integer NOT NULL,
	`decidedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connId`) REFERENCES `im_connection`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "im_pairing_request_status" CHECK("im_pairing_request"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `im_pairing_request_status_idx` ON `im_pairing_request` (`status`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `im_pairing_request_conn_sender_unique` ON `im_pairing_request` (`connId`,`senderId`);