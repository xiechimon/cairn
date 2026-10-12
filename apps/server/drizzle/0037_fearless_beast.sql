ALTER TABLE `build` DROP COLUMN `pinnedMachineId`;--> statement-breakpoint
ALTER TABLE `chief_thread` DROP COLUMN `pinnedMachineId`;--> statement-breakpoint
ALTER TABLE `schedule` DROP COLUMN `machineId`;--> statement-breakpoint
ALTER TABLE `todo` DROP COLUMN `machineId`;