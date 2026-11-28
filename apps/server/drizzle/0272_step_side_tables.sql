CREATE TABLE `step_quota` (
  `stepId` text PRIMARY KEY NOT NULL REFERENCES `step`(`id`) ON DELETE CASCADE,
  `quotaBlock` text,
  `fallback` text,
  `ranModel` text
);
--> statement-breakpoint
CREATE TABLE `step_subscription` (
  `stepId` text PRIMARY KEY NOT NULL REFERENCES `step`(`id`) ON DELETE CASCADE,
  `claudeSubscriptionId` text,
  `devinSubscriptionId` text,
  `antigravitySubscriptionId` text
);
--> statement-breakpoint
CREATE TABLE `step_schedule` (
  `stepId` text PRIMARY KEY NOT NULL REFERENCES `step`(`id`) ON DELETE CASCADE,
  `scheduleId` text,
  `scheduledBy` text
);
--> statement-breakpoint
CREATE TABLE `step_memory_trace` (
  `stepId` text PRIMARY KEY NOT NULL REFERENCES `step`(`id`) ON DELETE CASCADE,
  `memoryTrace` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `step_skill_injection` (
  `stepId` text PRIMARY KEY NOT NULL REFERENCES `step`(`id`) ON DELETE CASCADE,
  `skillInjection` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `step_blocker_handoff` (
  `stepId` text PRIMARY KEY NOT NULL REFERENCES `step`(`id`) ON DELETE CASCADE,
  `blockerHandoff` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `step_quota` (`stepId`, `quotaBlock`, `fallback`, `ranModel`)
SELECT `id`, `quotaBlock`, `fallback`, `ranModel` FROM `step`
WHERE `quotaBlock` IS NOT NULL OR `fallback` IS NOT NULL OR `ranModel` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `step_subscription` (`stepId`, `claudeSubscriptionId`, `devinSubscriptionId`, `antigravitySubscriptionId`)
SELECT `id`, `claudeSubscriptionId`, `devinSubscriptionId`, `antigravitySubscriptionId` FROM `step`
WHERE `claudeSubscriptionId` IS NOT NULL OR `devinSubscriptionId` IS NOT NULL OR `antigravitySubscriptionId` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `step_schedule` (`stepId`, `scheduleId`, `scheduledBy`)
SELECT `id`, `scheduleId`, `scheduledBy` FROM `step`
WHERE `scheduleId` IS NOT NULL OR `scheduledBy` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `step_memory_trace` (`stepId`, `memoryTrace`)
SELECT `id`, `memoryTrace` FROM `step` WHERE `memoryTrace` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `step_skill_injection` (`stepId`, `skillInjection`)
SELECT `id`, `skillInjection` FROM `step` WHERE `skillInjection` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `step_blocker_handoff` (`stepId`, `blockerHandoff`)
SELECT `id`, `blockerHandoff` FROM `step` WHERE `blockerHandoff` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `step_require_writer_generation_insert` BEFORE INSERT ON `step`
BEGIN
  SELECT CASE WHEN cairn_step_write_generation() IS NOT 1 THEN RAISE(ABORT, 'incompatible step writer generation') END;
END;
--> statement-breakpoint
CREATE TRIGGER `step_require_writer_generation_update` BEFORE UPDATE ON `step`
BEGIN
  SELECT CASE WHEN cairn_step_write_generation() IS NOT 1 THEN RAISE(ABORT, 'incompatible step writer generation') END;
END;
--> statement-breakpoint
CREATE TRIGGER `step_require_writer_generation_delete` BEFORE DELETE ON `step`
BEGIN
  SELECT CASE WHEN cairn_step_write_generation() IS NOT 1 THEN RAISE(ABORT, 'incompatible step writer generation') END;
END;
--> statement-breakpoint
CREATE TRIGGER `agent_memory_require_writer_generation_layer` BEFORE UPDATE OF `layer` ON `agent_memory`
BEGIN
  SELECT CASE WHEN cairn_step_write_generation() IS NOT 1 THEN RAISE(ABORT, 'incompatible step writer generation') END;
END;
