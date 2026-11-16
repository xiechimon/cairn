PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_connector` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`catalogId` text,
	`url` text NOT NULL,
	`headerNames` text NOT NULL,
	`valuesCipher` text,
	`authKind` text DEFAULT 'none' NOT NULL,
	`oauthMeta` text,
	`oauthCipher` text,
	`authRevision` integer DEFAULT 0 NOT NULL,
	`tokenGeneration` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`statusReason` text,
	`toolCount` integer,
	`checkedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mcp_connector_status" CHECK("__new_mcp_connector"."status" in ('unchecked', 'connected', 'needs_auth', 'error')),
	CONSTRAINT "mcp_connector_auth_kind" CHECK("__new_mcp_connector"."authKind" in ('none', 'static', 'oauth', 'github-app'))
);
--> statement-breakpoint
INSERT INTO `__new_mcp_connector`("id", "teamId", "slug", "label", "catalogId", "url", "headerNames", "valuesCipher", "authKind", "oauthMeta", "oauthCipher", "authRevision", "tokenGeneration", "status", "statusReason", "toolCount", "checkedAt", "createdAt", "updatedAt") SELECT "id", "teamId", "slug", "label", "catalogId", "url", "headerNames", "valuesCipher", "authKind", "oauthMeta", "oauthCipher", "authRevision", "tokenGeneration", "status", "statusReason", "toolCount", "checkedAt", "createdAt", "updatedAt" FROM `mcp_connector`;--> statement-breakpoint
DROP TABLE `mcp_connector`;--> statement-breakpoint
ALTER TABLE `__new_mcp_connector` RENAME TO `mcp_connector`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connector_team_slug_idx` ON `mcp_connector` (`teamId`,`slug`);