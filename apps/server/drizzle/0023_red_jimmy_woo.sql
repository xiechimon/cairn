ALTER TABLE `chief_thread` ADD `pinnedMachineId` text;--> statement-breakpoint
ALTER TABLE `todo` ADD `machineId` text;
--> statement-breakpoint
UPDATE `machine` SET `enabledRuntimes` = '["pi"]' WHERE `enabledRuntimes` = '[]';
