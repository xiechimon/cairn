CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`createdBy` text NOT NULL,
	`fileName` text NOT NULL,
	`mimeType` text NOT NULL,
	`sizeBytes` integer NOT NULL,
	`storageKey` text NOT NULL,
	`grantId` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
