DROP TABLE `harness_eval_attempts`;--> statement-breakpoint
DROP TABLE `harness_profile`;--> statement-breakpoint
DROP TABLE `thread_conversation`;--> statement-breakpoint
DROP TABLE `thread_entry`;--> statement-breakpoint
ALTER TABLE `coordinator_conversation` DROP COLUMN `lastColdSlimAt`;--> statement-breakpoint
ALTER TABLE `coordinator_conversation` DROP COLUMN `lastColdSlimStepId`;--> statement-breakpoint
ALTER TABLE `machine` DROP COLUMN `enabledRuntimes`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `tools`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `mcpServers`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `skillsAllowlist`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `defaultSkill`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `secrets`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `coAuthorTrailer`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `requestInstructorReview`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `firstPrReportPromptEnabled`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `firstPrReportPromptDismissedAt`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `firstPrReportPromptFirstPrAt`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `firstPrReportPromptFirstPrNumber`;--> statement-breakpoint
DROP TABLE IF EXISTS `legacy_agent_backup`;--> statement-breakpoint
DROP TABLE IF EXISTS `legacy_todo_assignment_backup`;--> statement-breakpoint
DROP TABLE IF EXISTS `legacy_chief_agent_backup`;--> statement-breakpoint
DROP TABLE IF EXISTS `legacy_routing_rule_adoption_backup`;