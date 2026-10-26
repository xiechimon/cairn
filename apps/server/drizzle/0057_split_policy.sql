ALTER TABLE `project` ADD `splitPolicy` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `todo` ADD `userSpecAttachmentIds` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `todo` ADD `userMessageAttachmentIds` text DEFAULT '[]' NOT NULL;