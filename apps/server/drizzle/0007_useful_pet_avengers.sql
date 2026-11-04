CREATE TABLE `steer_pending` (
	`conversationId` text PRIMARY KEY NOT NULL,
	`stepId` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL
);
