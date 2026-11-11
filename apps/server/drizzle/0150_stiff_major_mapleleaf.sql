ALTER TABLE `machine` ADD `browserOverride` integer;--> statement-breakpoint
ALTER TABLE `machine` ADD `desktopOverride` integer;
--> statement-breakpoint
UPDATE machine SET browserOverride = 1 WHERE id IN (SELECT machineId FROM computer WHERE browserEnabled = 1);
