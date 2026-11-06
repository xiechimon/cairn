CREATE TABLE IF NOT EXISTS `legacy_agent_backup` AS SELECT * FROM `agent`;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_todo_assignment_backup` AS SELECT `id` AS `todoId`, `teamId`, `assignment` FROM `todo` WHERE `assignment` IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_chief_agent_backup` AS SELECT `id` AS `chiefId`, `teamId`, `agentId` FROM `chief` WHERE `agentId` IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_routing_rule_adoption_backup` AS SELECT `id` AS `ruleId`, `teamId`, `adoptedAgentIds` FROM `routing_rule` WHERE `adoptedAgentIds` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `data_migration` (
	`id` text PRIMARY KEY NOT NULL,
	`doneAt` integer NOT NULL,
	`detail` text NOT NULL
);
