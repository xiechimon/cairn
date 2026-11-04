PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_token_usage` (
	`buildId` text NOT NULL,
	`model` text NOT NULL,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheWrite` integer DEFAULT 0 NOT NULL,
	`costInput` real,
	`costOutput` real,
	`costCacheRead` real,
	`costCacheWrite` real,
	`costTotal` real,
	PRIMARY KEY(`buildId`, `model`)
);
--> statement-breakpoint
INSERT INTO `__new_token_usage`("buildId", "model", "input", "output", "cacheRead", "cacheWrite", "costInput", "costOutput", "costCacheRead", "costCacheWrite", "costTotal") SELECT "buildId", "model", "input", "output", "cacheRead", "cacheWrite", "costInput", "costOutput", "costCacheRead", "costCacheWrite", "costTotal" FROM `token_usage`;--> statement-breakpoint
DROP TABLE `token_usage`;--> statement-breakpoint
ALTER TABLE `__new_token_usage` RENAME TO `token_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;