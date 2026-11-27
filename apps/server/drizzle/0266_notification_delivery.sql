ALTER TABLE `notification` ADD `deliveryId` text;--> statement-breakpoint
ALTER TABLE `notification` ADD `deliveryStatus` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification` ADD `deliveryTarget` text;--> statement-breakpoint
ALTER TABLE `notification` ADD `deliveryDueAt` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `lastDesktopActiveAt` integer;