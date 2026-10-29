ALTER TABLE `api_key` ADD `machineAccess` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `api_key` SET `machineAccess` = 1 WHERE `mcpAccess` = 0 AND `gitAccess` = 0;