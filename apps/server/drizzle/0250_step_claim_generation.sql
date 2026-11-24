ALTER TABLE `api_key` ADD `claimGeneration` integer;--> statement-breakpoint
ALTER TABLE `step` ADD `claimedRepo` text;--> statement-breakpoint
ALTER TABLE `step` ADD `claimedRepoId` integer;