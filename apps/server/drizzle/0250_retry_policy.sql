ALTER TABLE `build` ADD `retryClass` text;--> statement-breakpoint
ALTER TABLE `build` ADD `retryNextAt` integer;--> statement-breakpoint
ALTER TABLE `build` ADD `retryWindowStartedAt` integer;--> statement-breakpoint
ALTER TABLE `build` ADD `retryParkReason` text;