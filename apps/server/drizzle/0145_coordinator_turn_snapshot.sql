CREATE TABLE `coordinator_turn_snapshot` (
	`turnId` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`sourceTraceId` text NOT NULL,
	`schemaVersion` integer NOT NULL,
	`outcome` text NOT NULL,
	`capturedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`redactionCount` integer NOT NULL,
	`payloadBytes` integer NOT NULL,
	`digest` text,
	`payload` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "coordinator_turn_snapshot_version" CHECK("coordinator_turn_snapshot"."schemaVersion" > 0),
	CONSTRAINT "coordinator_turn_snapshot_outcome" CHECK("coordinator_turn_snapshot"."outcome" in ('success', 'failed', 'stopped')),
	CONSTRAINT "coordinator_turn_snapshot_expiry" CHECK("coordinator_turn_snapshot"."expiresAt" = "coordinator_turn_snapshot"."capturedAt" + 2592000000),
	CONSTRAINT "coordinator_turn_snapshot_redactions" CHECK("coordinator_turn_snapshot"."redactionCount" >= 0),
	CONSTRAINT "coordinator_turn_snapshot_payload" CHECK(
      ("coordinator_turn_snapshot"."status" = 'sealed' AND "coordinator_turn_snapshot"."reason" IS NULL AND "coordinator_turn_snapshot"."redactionCount" = 0
       AND "coordinator_turn_snapshot"."payload" IS NOT NULL AND json_valid("coordinator_turn_snapshot"."payload")
       AND "coordinator_turn_snapshot"."payloadBytes" = length(cast("coordinator_turn_snapshot"."payload" AS blob))
       AND "coordinator_turn_snapshot"."payloadBytes" <= 2097152
       AND "coordinator_turn_snapshot"."digest" IS NOT NULL AND length("coordinator_turn_snapshot"."digest") = 64
       AND "coordinator_turn_snapshot"."digest" NOT GLOB '*[^0-9a-f]*')
      OR ("coordinator_turn_snapshot"."status" = 'unusable' AND "coordinator_turn_snapshot"."payload" IS NULL AND "coordinator_turn_snapshot"."payloadBytes" = 0
       AND "coordinator_turn_snapshot"."digest" IS NULL AND "coordinator_turn_snapshot"."reason" IS NOT NULL
       AND length("coordinator_turn_snapshot"."reason") BETWEEN 1 AND 128))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coordinator_turn_snapshot_trace_idx` ON `coordinator_turn_snapshot` (`sourceTraceId`);--> statement-breakpoint
CREATE INDEX `coordinator_turn_snapshot_expiry_idx` ON `coordinator_turn_snapshot` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `coordinator_turn_snapshot_team_age_idx` ON `coordinator_turn_snapshot` (`teamId`,`capturedAt`,`turnId`);