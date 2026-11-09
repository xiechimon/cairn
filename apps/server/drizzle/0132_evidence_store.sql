ALTER TABLE `build` ADD `evidenceStore` text;--> statement-breakpoint
ALTER TABLE `project` ADD `evidenceStore` text DEFAULT 'attachments' NOT NULL;
--> statement-breakpoint
UPDATE `project` SET `evidenceStore` = 'repository' WHERE `githubRepo` = 'xiechimon/cairn';
