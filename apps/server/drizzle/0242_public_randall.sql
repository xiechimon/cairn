ALTER TABLE `chief_message` ADD `origin` text;--> statement-breakpoint
UPDATE `chief_message` SET `origin` = 'task-prompt' WHERE `role` = 'user' AND `id` LIKE 'user-%';