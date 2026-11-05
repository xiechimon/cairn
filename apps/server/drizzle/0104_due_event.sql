CREATE TABLE `due_event` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dueAt` integer NOT NULL,
	`intervalMs` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text
);
--> statement-breakpoint
CREATE INDEX `due_event_dueAt_idx` ON `due_event` (`dueAt`);