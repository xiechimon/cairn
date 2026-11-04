CREATE TABLE `skill_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`skillId` text NOT NULL,
	`actorType` text NOT NULL,
	`actorId` text NOT NULL,
	`action` text NOT NULL,
	`bytes` integer NOT NULL,
	`createdAt` integer NOT NULL
);
