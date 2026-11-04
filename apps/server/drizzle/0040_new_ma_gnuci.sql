ALTER TABLE `agent` ADD `machineId` text REFERENCES machine(id);--> statement-breakpoint
-- #1259 存量回填：全量 agent 绑到 mea（用户拍板：不做迁移横幅，直接迁）。
UPDATE `agent` SET `machineId` = (SELECT `id` FROM `machine` WHERE `machine`.`teamId` = `agent`.`teamId` AND `machine`.`name` LIKE 'mea%' LIMIT 1) WHERE `machineId` IS NULL;--> statement-breakpoint
ALTER TABLE `build` DROP COLUMN `pinnedMachineId`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `thinkingLevel`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `compactionModel`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `machineId`;--> statement-breakpoint
ALTER TABLE `chief_thread` DROP COLUMN `pinnedMachineId`;--> statement-breakpoint
ALTER TABLE `schedule` DROP COLUMN `machineId`;--> statement-breakpoint
ALTER TABLE `todo` DROP COLUMN `machineId`;