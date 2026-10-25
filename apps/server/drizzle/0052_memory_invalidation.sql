ALTER TABLE `agent_memory` ADD `invalidAt` integer;--> statement-breakpoint
ALTER TABLE `agent_memory` ADD `supersededBy` text;--> statement-breakpoint
ALTER TABLE `agent_memory` ADD `lastInjectedAt` integer;