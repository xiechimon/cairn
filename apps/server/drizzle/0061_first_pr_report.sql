ALTER TABLE `team` ADD `firstPrReportPromptEnabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `team` ADD `firstPrReportPromptDismissedAt` integer;--> statement-breakpoint
ALTER TABLE `team` ADD `firstPrReportPromptFirstPrAt` integer;--> statement-breakpoint
ALTER TABLE `team` ADD `firstPrReportPromptFirstPrNumber` integer;