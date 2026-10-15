ALTER TABLE `machine` ADD `maxConcurrentOverridden` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- 存量回填：maxConcurrent 的唯一用户写入面是 PATCH（列默认 3，0031），非默认值 = 用户写过，视为覆盖；
-- 恰为 3 的存量行无法与默认区分，按未覆盖处理（吃推荐值）。
UPDATE `machine` SET `maxConcurrentOverridden` = 1 WHERE `maxConcurrent` <> 3;
