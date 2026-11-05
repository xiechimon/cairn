ALTER TABLE `agent_memory` ADD `source` text;--> statement-breakpoint
ALTER TABLE `agent_memory` ADD `layer` text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_memory` ADD `threadId` text;