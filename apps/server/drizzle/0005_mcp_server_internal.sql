ALTER TABLE `mcp_server` ADD `command` text;--> statement-breakpoint
ALTER TABLE `mcp_server` ADD `args` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_server` ADD `headersCipher` text;