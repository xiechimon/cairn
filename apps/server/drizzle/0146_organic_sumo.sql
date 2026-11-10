CREATE TABLE `coordinator_input` (
	`id` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`stepId` text NOT NULL,
	`kind` text NOT NULL,
	`ownerMessageIds` text NOT NULL,
	`content` text NOT NULL,
	`conversationId` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`entryId` text,
	`successorStepId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`threadId`) REFERENCES `chief_thread`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coordinator_input_receipt" CHECK(("coordinator_input"."state" = 'consumed' AND "coordinator_input"."entryId" IS NOT NULL) OR ("coordinator_input"."state" IN ('pending', 'released') AND "coordinator_input"."entryId" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `coordinator_input_thread_state_idx` ON `coordinator_input` (`threadId`,`state`,`stepId`);