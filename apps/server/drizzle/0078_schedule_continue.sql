ALTER TABLE `schedule` ADD `lastRunError` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `lastRunStepId` text;--> statement-breakpoint
ALTER TABLE `step` ADD `scheduleId` text;--> statement-breakpoint
ALTER TABLE `step` ADD `scheduledBy` text;