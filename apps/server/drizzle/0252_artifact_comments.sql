ALTER TABLE `design_comment` ADD `anchor` text;--> statement-breakpoint
ALTER TABLE `design_comment` ADD `sentAt` integer;--> statement-breakpoint
UPDATE `design_comment` SET `sentAt` = `updatedAt` WHERE `status` <> 'open';--> statement-breakpoint
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
		AND json_extract(`i`.`value`, '$.kind') <> 'page'
	UNION ALL
	SELECT `a`.`teamId`, `a`.`todoId`, `a`.`fileName`, `a`.`id`, `a`.`sha256`, `a`.`createdBy`, `a`.`createdAt`
	FROM `attachment` `a`
	JOIN `todo` `t` ON `t`.`id` = `a`.`todoId`
	WHERE `a`.`scope` = 'message'
		AND `a`.`status` = 'ready'
		AND `a`.`createdBy` LIKE 'step:%'
) `src`
WHERE (lower(`src`.`fileName`) LIKE '%.md' OR lower(`src`.`fileName`) LIKE '%.markdown' OR lower(`src`.`fileName`) LIKE '%.svg' OR lower(`src`.`fileName`) LIKE '%.mmd' OR lower(`src`.`fileName`) LIKE '%.mermaid' OR lower(`src`.`fileName`) LIKE '%.excalidraw' OR lower(`src`.`fileName`) LIKE '%.csv' OR lower(`src`.`fileName`) LIKE '%.tsv' OR lower(`src`.`fileName`) LIKE '%.pdf' OR lower(`src`.`fileName`) LIKE '%.docx' OR lower(`src`.`fileName`) LIKE '%.png' OR lower(`src`.`fileName`) LIKE '%.jpg' OR lower(`src`.`fileName`) LIKE '%.jpeg' OR lower(`src`.`fileName`) LIKE '%.gif' OR lower(`src`.`fileName`) LIKE '%.webp' OR lower(`src`.`fileName`) LIKE '%.avif' OR lower(`src`.`fileName`) LIKE '%.mp4' OR lower(`src`.`fileName`) LIKE '%.webm' OR lower(`src`.`fileName`) LIKE '%.mov' OR lower(`src`.`fileName`) LIKE '%.py' OR lower(`src`.`fileName`) LIKE '%.ts' OR lower(`src`.`fileName`) LIKE '%.tsx' OR lower(`src`.`fileName`) LIKE '%.js' OR lower(`src`.`fileName`) LIKE '%.jsx' OR lower(`src`.`fileName`) LIKE '%.mjs' OR lower(`src`.`fileName`) LIKE '%.cjs' OR lower(`src`.`fileName`) LIKE '%.go' OR lower(`src`.`fileName`) LIKE '%.rs' OR lower(`src`.`fileName`) LIKE '%.rb' OR lower(`src`.`fileName`) LIKE '%.java' OR lower(`src`.`fileName`) LIKE '%.kt' OR lower(`src`.`fileName`) LIKE '%.swift' OR lower(`src`.`fileName`) LIKE '%.c' OR lower(`src`.`fileName`) LIKE '%.h' OR lower(`src`.`fileName`) LIKE '%.cpp' OR lower(`src`.`fileName`) LIKE '%.hpp' OR lower(`src`.`fileName`) LIKE '%.cs' OR lower(`src`.`fileName`) LIKE '%.sh' OR lower(`src`.`fileName`) LIKE '%.bash' OR lower(`src`.`fileName`) LIKE '%.zsh' OR lower(`src`.`fileName`) LIKE '%.sql' OR lower(`src`.`fileName`) LIKE '%.css' OR lower(`src`.`fileName`) LIKE '%.scss' OR lower(`src`.`fileName`) LIKE '%.json' OR lower(`src`.`fileName`) LIKE '%.yaml' OR lower(`src`.`fileName`) LIKE '%.yml' OR lower(`src`.`fileName`) LIKE '%.toml' OR lower(`src`.`fileName`) LIKE '%.xml' OR lower(`src`.`fileName`) LIKE '%.txt' OR lower(`src`.`fileName`) LIKE '%.log' OR lower(`src`.`fileName`) LIKE '%.diff' OR lower(`src`.`fileName`) LIKE '%.patch')
	AND NOT EXISTS (
		SELECT 1 FROM `design_version` `v` WHERE `v`.`todoId` = `src`.`todoId` AND `v`.`fileName` = `src`.`fileName`
	);