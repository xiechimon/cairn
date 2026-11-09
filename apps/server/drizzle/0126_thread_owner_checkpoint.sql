ALTER TABLE `todo` ADD `lastNotifiedOwner` text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE `todo` ADD `lastNotifiedWork` text DEFAULT '';--> statement-breakpoint
UPDATE `todo` SET `lastNotifiedOwner` = NULL, `lastNotifiedWork` = NULL;