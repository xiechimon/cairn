ALTER TABLE `chief_message` ADD `typedAt` integer;--> statement-breakpoint
ALTER TABLE `chief_message` ADD `sentByAgent` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `typedAt` integer;--> statement-breakpoint
ALTER TABLE `message` ADD `sentByAgent` integer;--> statement-breakpoint
ALTER TABLE `queued_message` ADD `sentByAgent` integer;--> statement-breakpoint
ALTER TABLE `step` ADD `ownerSaid` text;