ALTER TABLE `project` ADD `splitPolicy` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `team` ADD `autonomyPaused` integer DEFAULT false NOT NULL;