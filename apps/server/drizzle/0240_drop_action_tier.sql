ALTER TABLE `team` DROP COLUMN `actionTier`;--> statement-breakpoint
UPDATE `project` SET `autonomy` = json_remove(`autonomy`, '$.actionTier', '$.quietMinutes', '$.cooldownMinutes', '$.dailyBudgetUsd') WHERE `autonomy` IS NOT NULL;
