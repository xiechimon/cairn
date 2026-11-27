ALTER TABLE `chief_message` ADD `clientMessageId` text;--> statement-breakpoint
ALTER TABLE `message` ADD `clientMessageId` text;--> statement-breakpoint
ALTER TABLE `queued_message` ADD `clientMessageId` text;