ALTER TABLE `machine` ADD `kind` text DEFAULT 'remote' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine` ADD `enabledRuntimes` text DEFAULT '[]' NOT NULL;