PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text,
	`todoId` text,
	`chiefThreadId` text,
	`kind` text NOT NULL,
	`cron` text,
	`prompt` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`at` integer,
	`tz` text NOT NULL,
	`triggerSpec` text,
	`webhookTokenHash` text,
	`webhookMasked` text,
	`webhookDeliveries` text,
	`webhookLastUsedAt` integer,
	`missedRunWindowMs` integer,
	`createdAt` integer,
	`nextRunAt` integer,
	`lastRunAt` integer,
	`lastRunStatus` text,
	`lastRunError` text,
	`lastRunStepId` text,
	`retryNotBefore` integer,
	`pausedReason` text,
	`createdBy` text NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_target_xor" CHECK((("__new_schedule"."todoId" IS NOT NULL AND "__new_schedule"."chiefThreadId" IS NULL) OR ("__new_schedule"."todoId" IS NULL AND "__new_schedule"."chiefThreadId" IS NOT NULL)))
);
--> statement-breakpoint
INSERT INTO `__new_schedule`("id", "teamId", "projectId", "todoId", "chiefThreadId", "kind", "cron", "prompt", "enabled", "at", "tz", "triggerSpec", "webhookTokenHash", "webhookMasked", "webhookDeliveries", "webhookLastUsedAt", "missedRunWindowMs", "createdAt", "nextRunAt", "lastRunAt", "lastRunStatus", "lastRunError", "lastRunStepId", "retryNotBefore", "pausedReason", "createdBy") SELECT "id", "teamId", "projectId", "todoId", NULL, "kind", "cron", "prompt", "enabled", "at", "tz", "triggerSpec", "webhookTokenHash", "webhookMasked", "webhookDeliveries", "webhookLastUsedAt", "missedRunWindowMs", "createdAt", "nextRunAt", "lastRunAt", "lastRunStatus", "lastRunError", "lastRunStepId", "retryNotBefore", "pausedReason", "createdBy" FROM `schedule`;--> statement-breakpoint
DROP TABLE `schedule`;--> statement-breakpoint
ALTER TABLE `__new_schedule` RENAME TO `schedule`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `schedule_nextRunAt_idx` ON `schedule` (`nextRunAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_todoId_unique` ON `schedule` (`todoId`);--> statement-breakpoint
CREATE INDEX `schedule_chiefThreadId_idx` ON `schedule` (`chiefThreadId`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_webhookTokenHash_unique` ON `schedule` (`webhookTokenHash`);--> statement-breakpoint
UPDATE `schedule`
SET
  `chiefThreadId` = (
    SELECT ct.`id`
    FROM `todo` t
    INNER JOIN `chief_thread` ct ON ct.`id` = 'chief-' || substr(t.`sourceRef`, 7)
    WHERE t.`id` = `schedule`.`todoId`
      AND t.`teamId` = `schedule`.`teamId`
      AND t.`output` IN ('info', 'report', 'dataset', 'link')
      AND t.`sourceKind` = 'orchestration'
      AND t.`sourceRef` LIKE 'chief:%'
      AND ct.`teamId` = `schedule`.`teamId`
      AND ct.`archivedAt` IS NULL
      AND (ct.`projectId` IS NULL OR EXISTS (SELECT 1 FROM `project` p WHERE p.`id` = ct.`projectId` AND p.`teamId` = `schedule`.`teamId`))
  ),
  `projectId` = (
    SELECT ct.`projectId`
    FROM `todo` t
    INNER JOIN `chief_thread` ct ON ct.`id` = 'chief-' || substr(t.`sourceRef`, 7)
    WHERE t.`id` = `schedule`.`todoId`
      AND t.`teamId` = `schedule`.`teamId`
      AND t.`output` IN ('info', 'report', 'dataset', 'link')
      AND t.`sourceKind` = 'orchestration'
      AND t.`sourceRef` LIKE 'chief:%'
      AND ct.`teamId` = `schedule`.`teamId`
      AND ct.`archivedAt` IS NULL
      AND (ct.`projectId` IS NULL OR EXISTS (SELECT 1 FROM `project` p WHERE p.`id` = ct.`projectId` AND p.`teamId` = `schedule`.`teamId`))
  ),
  `prompt` = COALESCE(
    NULLIF(trim(`schedule`.`prompt`), ''),
    (SELECT NULLIF(trim(t.`spec`), '') FROM `todo` t WHERE t.`id` = `schedule`.`todoId` AND t.`teamId` = `schedule`.`teamId`),
    (SELECT NULLIF(trim(t.`title`), '') FROM `todo` t WHERE t.`id` = `schedule`.`todoId` AND t.`teamId` = `schedule`.`teamId`)
  ),
  `todoId` = NULL
WHERE `schedule`.`kind` != 'event'
  AND `schedule`.`todoId` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `todo` t
    INNER JOIN `chief_thread` ct ON ct.`id` = 'chief-' || substr(t.`sourceRef`, 7)
    WHERE t.`id` = `schedule`.`todoId`
      AND t.`teamId` = `schedule`.`teamId`
      AND t.`output` IN ('info', 'report', 'dataset', 'link')
      AND t.`sourceKind` = 'orchestration'
      AND t.`sourceRef` LIKE 'chief:%'
      AND ct.`teamId` = `schedule`.`teamId`
      AND ct.`archivedAt` IS NULL
      AND (ct.`projectId` IS NULL OR EXISTS (SELECT 1 FROM `project` p WHERE p.`id` = ct.`projectId` AND p.`teamId` = `schedule`.`teamId`))
      AND COALESCE(NULLIF(trim(`schedule`.`prompt`), ''), NULLIF(trim(t.`spec`), ''), NULLIF(trim(t.`title`), '')) IS NOT NULL
  );--> statement-breakpoint
UPDATE `todo`
SET `output` = 'code'
WHERE `output` IN ('info', 'report', 'dataset', 'link')
  AND `phase` NOT IN ('done', 'closed')
  AND (
    COALESCE(`sourceKind`, '') != 'research-stuck'
    OR EXISTS (SELECT 1 FROM `schedule` s WHERE s.`todoId` = `todo`.`id` AND s.`teamId` = `todo`.`teamId`)
  );
