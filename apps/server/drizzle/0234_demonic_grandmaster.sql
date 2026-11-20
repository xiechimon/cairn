CREATE TABLE `design_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`todoId` text NOT NULL,
	`fileName` text NOT NULL,
	`versionId` text NOT NULL,
	`pin` integer NOT NULL,
	`elementId` text NOT NULL,
	`selector` text NOT NULL,
	`label` text NOT NULL,
	`text` text NOT NULL,
	`htmlHint` text NOT NULL,
	`position` text NOT NULL,
	`viewport` text NOT NULL,
	`style` text,
	`note` text NOT NULL,
	`markAttachmentId` text,
	`status` text NOT NULL,
	`messageId` text,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`versionId`) REFERENCES `design_version`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_comment_page_pin_idx` ON `design_comment` (`todoId`,`fileName`,`pin`);--> statement-breakpoint
CREATE INDEX `design_comment_status_idx` ON `design_comment` (`todoId`,`status`);--> statement-breakpoint
CREATE TABLE `design_share` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`todoId` text NOT NULL,
	`fileName` text NOT NULL,
	`token` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`revokedAt` integer,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_share_token_idx` ON `design_share` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `design_share_live_idx` ON `design_share` (`todoId`,`fileName`) WHERE "revokedAt" IS NULL;--> statement-breakpoint
CREATE TABLE `design_version` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`todoId` text NOT NULL,
	`fileName` text NOT NULL,
	`seq` integer NOT NULL,
	`attachmentId` text NOT NULL,
	`sha256` text,
	`source` text NOT NULL,
	`restoredFromVersionId` text,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_version_page_seq_idx` ON `design_version` (`todoId`,`fileName`,`seq`);--> statement-breakpoint
INSERT INTO `design_version` (`id`, `teamId`, `todoId`, `fileName`, `seq`, `attachmentId`, `sha256`, `source`, `restoredFromVersionId`, `createdBy`, `createdAt`)
SELECT 'dv-' || lower(hex(randomblob(12))), `teamId`, `todoId`, `fileName`,
	row_number() OVER (PARTITION BY `todoId`, `fileName` ORDER BY `createdAt`, `attachmentId`),
	`attachmentId`, `sha256`, 'agent', NULL, `createdBy`, `createdAt`
FROM (
	SELECT `a`.`teamId` AS `teamId`, `b`.`todoId` AS `todoId`, json_extract(`i`.`value`, '$.name') AS `fileName`,
		`a`.`id` AS `attachmentId`, `a`.`sha256` AS `sha256`, `a`.`createdBy` AS `createdBy`, `m`.`createdAt` AS `createdAt`
	FROM (
		SELECT `conversationId`, `createdAt`,
			CASE WHEN json_type(`content`) = 'text' THEN json_extract(`content`, '$') ELSE `content` END AS `content`
		FROM `message`
		WHERE `id` LIKE 'deliverables-%' AND json_valid(`content`)
	) `m`
	JOIN `build` `b` ON `b`.`id` = `m`.`conversationId`
	JOIN json_each(`m`.`content`, '$.items') `i`
	JOIN `attachment` `a` ON `a`.`id` = json_extract(`i`.`value`, '$.attachmentId')
	WHERE json_valid(`m`.`content`)
		AND json_extract(`m`.`content`, '$.kind') = 'deliverables'
		AND json_extract(`i`.`value`, '$.kind') = 'page'
	UNION ALL
	SELECT `a`.`teamId`, `a`.`todoId`, `a`.`fileName`, `a`.`id`, `a`.`sha256`, `a`.`createdBy`, `a`.`createdAt`
	FROM `attachment` `a`
	JOIN `todo` `t` ON `t`.`id` = `a`.`todoId`
	WHERE `a`.`scope` = 'message'
		AND `a`.`status` = 'ready'
		AND `a`.`createdBy` LIKE 'step:%'
		AND (lower(`a`.`fileName`) LIKE '%.html' OR lower(`a`.`fileName`) LIKE '%.htm')
);
