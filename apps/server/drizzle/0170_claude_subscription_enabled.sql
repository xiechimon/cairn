ALTER TABLE `claude_subscription` ADD `enabledAt` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `claude_subscription_one_enabled` ON `claude_subscription` (`teamId`) WHERE "claude_subscription"."enabledAt" is not null;--> statement-breakpoint
ALTER TABLE `step` ADD `claudeSubscriptionId` text;--> statement-breakpoint
UPDATE `claude_subscription` SET `enabledAt` = `createdAt` WHERE `id` IN (SELECT `id` FROM (SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `teamId` ORDER BY `createdAt` DESC, `id` DESC) AS `rn` FROM `claude_subscription` WHERE `expiresAt` IS NULL OR `expiresAt` > CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE `rn` = 1);--> statement-breakpoint
UPDATE `step` SET `claudeSubscriptionId` = (SELECT `cs`.`id` FROM `claude_subscription` `cs` INNER JOIN `machine` `m` ON `m`.`teamId` = `cs`.`teamId` WHERE `m`.`id` = `step`.`machineId` AND `cs`.`enabledAt` IS NOT NULL) WHERE `status` = 'claimed' AND `machineId` IS NOT NULL;
