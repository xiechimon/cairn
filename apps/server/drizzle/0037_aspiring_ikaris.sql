ALTER TABLE `step` ADD `holdReason` text;--> statement-breakpoint
ALTER TABLE `step` ADD `holdUntil` integer;--> statement-breakpoint
ALTER TABLE `step` ADD `holdCount` integer DEFAULT 0 NOT NULL;