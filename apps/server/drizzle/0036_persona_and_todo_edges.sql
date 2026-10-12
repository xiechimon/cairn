ALTER TABLE `agent` ADD `persona` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_team_persona_unique` ON `agent` (`teamId`,`persona`) WHERE persona is not null;--> statement-breakpoint
ALTER TABLE `todo` ADD `blockedBy` text;
