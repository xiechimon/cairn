CREATE TABLE `coordinator_conversation` (
	`threadId` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`lastMirroredEntryId` text,
	`piVersion` text NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coordinator_entry` (
	`chiefMessageId` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`conversationId` text NOT NULL,
	`entryId` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coordinator_entry_thread_idx` ON `coordinator_entry` (`threadId`,`conversationId`);--> statement-breakpoint
CREATE TABLE `coordinator_lease` (
	`storeKey` text PRIMARY KEY NOT NULL,
	`owner` text,
	`heartbeatAt` integer NOT NULL
);
