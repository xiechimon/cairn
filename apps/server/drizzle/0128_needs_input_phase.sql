UPDATE `todo` SET `phase` = 'needs_input' WHERE `awaitingReply` = 1 AND `phase` = 'review';--> statement-breakpoint
ALTER TABLE `todo` DROP COLUMN `awaitingReply`;