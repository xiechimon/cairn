CREATE TABLE `mcp_connector` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`catalogId` text,
	`url` text NOT NULL,
	`headerNames` text NOT NULL,
	`valuesCipher` text,
	`status` text NOT NULL,
	`statusReason` text,
	`toolCount` integer,
	`checkedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mcp_connector_status" CHECK("mcp_connector"."status" in ('unchecked', 'connected', 'needs_auth', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connector_team_slug_idx` ON `mcp_connector` (`teamId`,`slug`);