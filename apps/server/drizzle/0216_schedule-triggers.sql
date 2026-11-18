ALTER TABLE `schedule` ADD `triggerSpec` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `webhookTokenHash` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `webhookMasked` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `webhookDeliveries` text;--> statement-breakpoint
ALTER TABLE `schedule` ADD `webhookLastUsedAt` integer;--> statement-breakpoint
ALTER TABLE `schedule` ADD `missedRunWindowMs` integer;--> statement-breakpoint
ALTER TABLE `schedule` ADD `createdAt` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_webhookTokenHash_unique` ON `schedule` (`webhookTokenHash`);