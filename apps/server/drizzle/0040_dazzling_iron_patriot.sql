ALTER TABLE `agent` ADD `machineId` text REFERENCES machine(id);--> statement-breakpoint
-- 存量回填（#1259 用户裁定）：未设归属机的存量 agent 一律绑到团队的 mea 机（name LIKE 'mea%'）；无 mea 机的团队留 null = 不可领，UI 补设即解锁。
UPDATE `agent` SET `machineId` = (SELECT `id` FROM `machine` WHERE `machine`.`teamId` = `agent`.`teamId` AND `machine`.`name` LIKE 'mea%' LIMIT 1) WHERE `machineId` IS NULL;--> statement-breakpoint
ALTER TABLE `build` DROP COLUMN `pinnedMachineId`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `thinkingLevel`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `compactionModel`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `model`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `machineId`;--> statement-breakpoint
ALTER TABLE `chief_thread` DROP COLUMN `pinnedMachineId`;--> statement-breakpoint
ALTER TABLE `schedule` DROP COLUMN `machineId`;--> statement-breakpoint
ALTER TABLE `todo` DROP COLUMN `machineId`;