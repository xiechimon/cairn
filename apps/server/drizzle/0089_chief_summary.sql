CREATE TABLE `chief_summary` (
	`threadId` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`coveredThroughId` text NOT NULL,
	`coveredAt` integer NOT NULL,
	`coveredRowid` integer NOT NULL,
	`compactedMessages` integer NOT NULL,
	`generation` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
