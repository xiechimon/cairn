ALTER TABLE `project` ADD `maxConcurrent` integer;--> statement-breakpoint
ALTER TABLE `step` ADD `byPerson` integer DEFAULT false NOT NULL;