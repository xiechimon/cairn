ALTER TABLE `chief_thread` ADD `memoryFlushedAt` integer;--> statement-breakpoint
ALTER TABLE `chief_thread` ADD `memoryFlushedMessageId` text;--> statement-breakpoint
CREATE INDEX `chief_message_thread_insert_idx` ON `chief_message` (`threadId`);--> statement-breakpoint
DELETE FROM `due_event` WHERE `id` = 'gc:coordinator-snapshots';
