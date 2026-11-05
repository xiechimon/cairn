CREATE TABLE `feature_flag` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`userId` text,
	`enabled` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flag_key_global_unique` ON `feature_flag` (`key`) WHERE "feature_flag"."userId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flag_key_user_unique` ON `feature_flag` (`key`,`userId`) WHERE "feature_flag"."userId" IS NOT NULL;