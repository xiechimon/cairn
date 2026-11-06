SELECT abs(-9223372036854775807 - 1) WHERE NOT EXISTS (SELECT 1 FROM `data_migration` WHERE `id` = 'drop-agents') AND EXISTS (SELECT 1 FROM `agent`);--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `agentId`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `adoptedAgentIds`;--> statement-breakpoint
ALTER TABLE `todo` DROP COLUMN `assignment`;
