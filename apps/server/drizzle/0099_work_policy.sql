CREATE TABLE `work_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`use` text NOT NULL,
	`tools` text NOT NULL,
	`mcpServers` text NOT NULL,
	`skillsAllowlist` text,
	`defaultSkill` text,
	`secrets` text NOT NULL,
	`seededFromAgentId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_policy_team_use_unique` ON `work_policy` (`teamId`,`use`);