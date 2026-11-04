ALTER TABLE `machine` ADD `apiKeyId` text;--> statement-breakpoint
ALTER TABLE `step` ADD `sessionId` text;--> statement-breakpoint
ALTER TABLE `step` ADD `claimedAt` integer;--> statement-breakpoint
ALTER TABLE `step` ADD `lastHeartbeatAt` integer;