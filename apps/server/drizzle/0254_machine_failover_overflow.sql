ALTER TABLE `machine` ADD `maxConcurrency` integer;--> statement-breakpoint
ALTER TABLE `machine` ADD `autoDispatch` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `step` ADD `targetMachineId` text;--> statement-breakpoint
ALTER TABLE `step` ADD `routedFromMachineId` text;--> statement-breakpoint
ALTER TABLE `step` ADD `routedReason` text;
