CREATE TABLE `harness_eval_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`pr` integer NOT NULL,
	`patchDigest` text NOT NULL,
	`workerId` text NOT NULL,
	`state` text NOT NULL,
	`deadlineAt` integer NOT NULL,
	`outcome` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harness_eval_attempts_repo_pr_digest_unique` ON `harness_eval_attempts` (`repo`,`pr`,`patchDigest`);