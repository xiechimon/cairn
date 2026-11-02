ALTER TABLE `chief_thread` ADD `compactGeneration` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chief_thread` ADD `compactSummary` text;--> statement-breakpoint
ALTER TABLE `chief_thread` ADD `compactAttempt` text;--> statement-breakpoint
ALTER TABLE `chief_turn_usage` ADD `contextTokens` integer;--> statement-breakpoint
ALTER TABLE `step` ADD `compactOnly` integer DEFAULT false NOT NULL;