ALTER TABLE `build` ADD `reportAttachmentId` text;--> statement-breakpoint
ALTER TABLE `todo` ADD `output` text DEFAULT 'code' NOT NULL;