CREATE TABLE `thread_conversation` (
	`threadId` text PRIMARY KEY NOT NULL,
	`storeId` text NOT NULL,
	`conversationId` text NOT NULL,
	`lastMirroredEntryId` text,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_entry` (
	`messageId` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`conversationId` text NOT NULL,
	`entryId` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_entry_thread_idx` ON `thread_entry` (`threadId`,`conversationId`);