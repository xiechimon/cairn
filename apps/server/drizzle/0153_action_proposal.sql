CREATE TABLE `action_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`actionId` text NOT NULL,
	`targetId` text NOT NULL,
	`inputJson` text NOT NULL,
	`inputHash` text NOT NULL,
	`status` text NOT NULL,
	`decision` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`decidedBy` text,
	`decidedAt` integer,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_proposal_pending_idx` ON `action_proposal` (`teamId`,`actionId`,`targetId`) WHERE "action_proposal"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `action_proposal_expiry_idx` ON `action_proposal` (`status`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `action_subscriber` (
	`id` text PRIMARY KEY NOT NULL,
	`proposalId` text NOT NULL,
	`threadId` text NOT NULL,
	`wakeStepId` text NOT NULL,
	`scopeProjectId` text,
	FOREIGN KEY (`proposalId`) REFERENCES `action_proposal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_subscriber_proposal_thread_idx` ON `action_subscriber` (`proposalId`,`threadId`);--> statement-breakpoint
CREATE TABLE `action_wake_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`proposalId` text NOT NULL,
	`threadId` text NOT NULL,
	`outcome` text NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`proposalId`) REFERENCES `action_proposal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_wake_outbox_proposal_thread_idx` ON `action_wake_outbox` (`proposalId`,`threadId`);