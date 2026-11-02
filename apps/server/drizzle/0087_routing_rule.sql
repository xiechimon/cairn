CREATE TABLE `routing_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`use` text NOT NULL,
	`provider` text NOT NULL,
	`modelId` text NOT NULL,
	`thinkingLevel` text,
	`fallbackModels` text,
	`machineId` text,
	`seededFromAgentId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machineId`) REFERENCES `machine`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routing_rule_team_use_unique` ON `routing_rule` (`teamId`,`use`);