CREATE TABLE `external_effect` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`scopeKind` text NOT NULL,
	`scopeId` text NOT NULL,
	`stepId` text,
	`claimGeneration` integer,
	`kind` text NOT NULL,
	`dedupeKey` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`dueAt` integer NOT NULL,
	`claimedAt` integer,
	`claimFence` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`receipt` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_effect_state" CHECK("external_effect"."state" in ('pending', 'sending', 'delivered', 'failed', 'interrupted', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_effect_dedupe_idx` ON `external_effect` (`dedupeKey`);--> statement-breakpoint
CREATE INDEX `external_effect_state_due_idx` ON `external_effect` (`state`,`dueAt`);--> statement-breakpoint
CREATE INDEX `external_effect_scope_idx` ON `external_effect` (`scopeKind`,`scopeId`);--> statement-breakpoint
CREATE TABLE `im_seen_inbound` (
	`connId` text NOT NULL,
	`messageId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`connId`, `messageId`),
	FOREIGN KEY (`connId`) REFERENCES `im_connection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `im_seen_inbound_conn_idx` ON `im_seen_inbound` (`connId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `im_turn_origin` (
	`stepId` text PRIMARY KEY NOT NULL,
	`connId` text NOT NULL,
	`chatKey` text NOT NULL,
	`senderId` text NOT NULL,
	`threadId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`connId`) REFERENCES `im_connection`(`id`) ON UPDATE no action ON DELETE cascade
);
