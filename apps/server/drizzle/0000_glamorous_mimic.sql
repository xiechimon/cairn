CREATE TABLE `agent` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`displayName` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`avatarUrl` text,
	`provider` text,
	`modelId` text,
	`thinkingLevel` text,
	`tools` text DEFAULT '[]' NOT NULL,
	`secrets` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`mcpServers` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`agentId` text NOT NULL,
	`teamId` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`projectId` text,
	`sourceTodoId` text,
	`sourceBuildId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text,
	`gitAccess` integer DEFAULT false NOT NULL,
	`mcpAccess` integer DEFAULT false NOT NULL,
	`toolGrants` text NOT NULL,
	`keyHash` text NOT NULL,
	`masked` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `build` (
	`id` text PRIMARY KEY NOT NULL,
	`todoId` text NOT NULL,
	`withPlan` integer NOT NULL,
	`prevPhase` text,
	`triggerSource` text NOT NULL,
	`pinnedMachineId` text,
	`planDocId` text,
	`errorMessage` text,
	`prUrl` text,
	`prNumber` integer,
	`diffHash` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chief_message` (
	`id` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`threadId`) REFERENCES `chief_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chief_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`chiefId` text NOT NULL,
	`userId` text NOT NULL,
	`teamId` text NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`lastTurnAt` integer,
	`sessionRuntime` text DEFAULT 'pi' NOT NULL,
	`sessionId` text NOT NULL,
	`sessionOpenedAt` integer NOT NULL,
	`pendingSessionResumeAt` integer,
	`toolDefHashes` text DEFAULT '{}' NOT NULL,
	`toolResultHashes` text DEFAULT '{}' NOT NULL,
	`activeRun` text
);
--> statement-breakpoint
CREATE TABLE `document_diff` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`fromVersion` integer NOT NULL,
	`toVersion` integer NOT NULL,
	`files` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `machine` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`online` integer DEFAULT false NOT NULL,
	`maxConcurrent` integer DEFAULT 3 NOT NULL,
	`tokenHash` text,
	`latestCliVersion` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`label` text NOT NULL,
	`slug` text NOT NULL,
	`transport` text NOT NULL,
	`url` text NOT NULL,
	`hasCredential` integer DEFAULT false NOT NULL,
	`credentialKeys` text DEFAULT '[]' NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`entityId` text NOT NULL,
	`entityRef` text NOT NULL,
	`agentName` text NOT NULL,
	`agentAvatarUrl` text,
	`snippet` text,
	`readAt` integer,
	`createdAt` integer NOT NULL,
	`channels` text DEFAULT '["in_app"]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan` (
	`id` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`teamId` text NOT NULL,
	`repoKind` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `provider` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`providerId` text NOT NULL,
	`label` text NOT NULL,
	`baseUrl` text NOT NULL,
	`api` text NOT NULL,
	`authHeader` integer DEFAULT true NOT NULL,
	`compat` text NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`apiKeyCipher` text,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text NOT NULL,
	`todoId` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer,
	`tz` text NOT NULL,
	`machineId` text,
	`nextRunAt` integer,
	`createdBy` text NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `secret` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`valueCipher` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `skill` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`files` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `step` (
	`id` text PRIMARY KEY NOT NULL,
	`buildId` text NOT NULL,
	`kind` text NOT NULL,
	`machineId` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`avatarStyle` text
);
--> statement-breakpoint
CREATE TABLE `todo` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text NOT NULL,
	`title` text NOT NULL,
	`spec` text DEFAULT '' NOT NULL,
	`phase` text DEFAULT 'todo' NOT NULL,
	`phaseAt` integer NOT NULL,
	`seqNum` integer NOT NULL,
	`orderIndex` real DEFAULT 0 NOT NULL,
	`assignment` text,
	`latestBuildId` text,
	`lastRunAt` integer,
	`hasChanges` integer DEFAULT false NOT NULL,
	`hasPlan` integer DEFAULT false NOT NULL,
	`sourceTodo` text,
	`v` integer DEFAULT 1 NOT NULL,
	`createdBy` text,
	`ownerId` text,
	`sourceBuildId` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `todo_tag` (
	`todoId` text NOT NULL,
	`tagId` text NOT NULL,
	PRIMARY KEY(`todoId`, `tagId`),
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagId`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `token_usage` (
	`buildId` text NOT NULL,
	`model` text NOT NULL,
	`input` integer DEFAULT 0 NOT NULL,
	`output` integer DEFAULT 0 NOT NULL,
	`cacheRead` integer DEFAULT 0 NOT NULL,
	`cacheWrite` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`buildId`, `model`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`displayName` text NOT NULL,
	`avatarUrl` text
);
--> statement-breakpoint
CREATE TABLE `whats_new` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`createdAt` integer NOT NULL
);
