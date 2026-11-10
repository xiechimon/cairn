CREATE TABLE `coordinator_run` (
	`threadId` text NOT NULL,
	`conversationId` text NOT NULL,
	`taskId` text NOT NULL,
	`stepId` text NOT NULL,
	PRIMARY KEY(`threadId`, `conversationId`, `taskId`),
	FOREIGN KEY (`threadId`) REFERENCES `chief_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `coordinator_conversation` ADD `storeId` text;--> statement-breakpoint
CREATE UNIQUE INDEX `coordinator_input_initial_unique` ON `coordinator_input` (`stepId`,`conversationId`) WHERE "coordinator_input"."kind" = 'initial';