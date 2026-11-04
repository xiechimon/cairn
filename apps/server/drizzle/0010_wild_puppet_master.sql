CREATE TABLE `stop_pending` (
	`conversationId` text PRIMARY KEY NOT NULL,
	`stepId` text NOT NULL,
	`discard` integer NOT NULL,
	`createdAt` integer NOT NULL
);
