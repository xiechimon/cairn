ALTER TABLE `chief_turn_usage` ADD `firstReportAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `chief_turn_usage` SET `firstReportAt` = `createdAt`;