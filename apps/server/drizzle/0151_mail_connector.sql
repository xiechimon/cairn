CREATE TABLE `mail_account` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`mailbox` text NOT NULL,
	`status` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`historyWatermark` text,
	`uidValidity` text,
	`lastReconciledUid` integer,
	`pushServiceAccountEmail` text,
	`secretId` text,
	`watchExpiration` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`secretId`) REFERENCES `secret`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mail_account_status" CHECK("mail_account"."status" in ('disconnected', 'connecting', 'watching', 'degraded', 'revoked')),
	CONSTRAINT "mail_account_provider" CHECK("mail_account"."provider" in ('gmail', 'imap'))
);
--> statement-breakpoint
CREATE INDEX `mail_account_team_idx` ON `mail_account` (`teamId`);--> statement-breakpoint
CREATE TABLE `mail_event` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`externalId` text NOT NULL,
	`status` text NOT NULL,
	`rank` text,
	`ruleId` text,
	`ruleName` text,
	`dropReason` text,
	`generation` integer NOT NULL,
	`displayName` text,
	`fromAddress` text,
	`subject` text,
	`excerpt` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `mail_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mail_event_status" CHECK("mail_event"."status" in ('received', 'ranked', 'delivered', 'dropped')),
	CONSTRAINT "mail_event_rank" CHECK("mail_event"."rank" is null or "mail_event"."rank" in ('needs_you', 'can_wait', 'drop')),
	CONSTRAINT "mail_event_drop_reason" CHECK("mail_event"."status" != 'dropped' or "mail_event"."dropReason" is not null),
	CONSTRAINT "mail_event_dropped_body" CHECK("mail_event"."status" != 'dropped' or ("mail_event"."excerpt" is null and "mail_event"."subject" is null and "mail_event"."displayName" is null and "mail_event"."fromAddress" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_event_account_external_unique` ON `mail_event` (`accountId`,`externalId`);--> statement-breakpoint
CREATE TABLE `mail_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`name` text NOT NULL,
	`matchKind` text NOT NULL,
	`pattern` text NOT NULL,
	`rank` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `mail_account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mail_rule_kind" CHECK("mail_rule"."matchKind" in ('sender_allow', 'subject_contains')),
	CONSTRAINT "mail_rule_rank" CHECK("mail_rule"."rank" in ('needs_you', 'can_wait', 'drop')),
	CONSTRAINT "mail_rule_pattern" CHECK(length(trim("mail_rule"."pattern")) > 0)
);
--> statement-breakpoint
CREATE INDEX `mail_rule_account_idx` ON `mail_rule` (`accountId`,`createdAt`,`id`);