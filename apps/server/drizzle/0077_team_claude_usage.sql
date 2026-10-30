ALTER TABLE `team` ADD `claudeUsage` text DEFAULT 'subscription-only' NOT NULL;
--> statement-breakpoint
UPDATE `team` SET `claudeUsage` = 'allow-paid';
