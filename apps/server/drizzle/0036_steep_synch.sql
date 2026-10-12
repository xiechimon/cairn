ALTER TABLE `agent` ADD `machineId` text REFERENCES machine(id);--> statement-breakpoint
-- #1259 存量回填：全部 agent 归属机 = 本团队的 mea 机器（2026-10-12 用户拍板
-- 「直接先全部弄到 mea」）。按机器名前缀匹配；他团队/无 mea 机的库自然
-- 零命中（machineId 留 null = 未设归属机，UI 可补），不替存量编造归属。
UPDATE `agent` SET `machineId` = (
  SELECT `id` FROM `machine`
  WHERE `machine`.`teamId` = `agent`.`teamId` AND `machine`.`name` LIKE 'mea%'
  LIMIT 1
) WHERE `machineId` IS NULL;
