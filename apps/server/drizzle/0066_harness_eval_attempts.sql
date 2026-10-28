CREATE TABLE `harness_eval_attempts` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`pr` integer NOT NULL,
	`digest` text NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harness_eval_attempt_digest_unique` ON `harness_eval_attempts` (`repo`,`pr`,`digest`);--> statement-breakpoint
CREATE TABLE `harness_eval_current` (
	`repo` text NOT NULL,
	`pr` integer NOT NULL,
	`worker_id` text NOT NULL,
	PRIMARY KEY(`repo`, `pr`)
);
