CREATE TABLE `push_delivery` (
	`message` text,
	`pushStatus` text DEFAULT 'unknown' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`teamId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`receivedAt` integer,
	`alertStatus` text
);
