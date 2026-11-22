ALTER TABLE `machine` ADD `hostKey` text;--> statement-breakpoint
ALTER TABLE `machine` ADD `retiredAt` integer;--> statement-breakpoint
CREATE INDEX `machine_team_hostKey_idx` ON `machine` (`teamId`,`hostKey`);