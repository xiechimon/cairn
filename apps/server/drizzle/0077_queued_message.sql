CREATE TABLE `queued_message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`content` text NOT NULL,
	`deliverAfterStop` integer DEFAULT false NOT NULL,
	`error` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`conversationId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `queued_message_conversation_idx` ON `queued_message` (`conversationId`,`createdAt`);