CREATE TABLE IF NOT EXISTS `legacy_agent_backup` AS SELECT * FROM `agent`;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_todo_assignment_backup` AS SELECT `id` AS `todoId`, `teamId`, `assignment` FROM `todo` WHERE `assignment` IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_chief_agent_backup` AS SELECT `id` AS `chiefId`, `teamId`, `agentId` FROM `chief` WHERE `agentId` IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_routing_rule_adoption_backup` AS SELECT `id` AS `ruleId`, `teamId`, `adoptedAgentIds` FROM `routing_rule` WHERE `adoptedAgentIds` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `routing_rule` (`id`, `teamId`, `use`, `provider`, `modelId`, `thinkingLevel`, `fallbackModels`, `machineId`, `requiredCapabilities`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), a.`teamId`, 'session', a.`provider`, a.`modelId`, a.`thinkingLevel`, a.`fallbackModels`, a.`machineId`, a.`requiredCapabilities`, a.`id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `agent` a
WHERE a.`id` = (
  SELECT b.`id` FROM `agent` b
  WHERE b.`teamId` = a.`teamId` AND b.`provider` IS NOT NULL AND b.`modelId` IS NOT NULL
    AND b.`id` NOT IN (SELECT `agentId` FROM `chief` WHERE `agentId` IS NOT NULL)
    AND (b.`persona` = 'implementer' OR (SELECT count(*) FROM `todo` t WHERE t.`teamId` = b.`teamId` AND json_extract(t.`assignment`, '$.build.agentId') = b.`id`) > 0)
  ORDER BY coalesce(b.`persona` = 'implementer', 0) DESC,
    (SELECT count(*) FROM `todo` t WHERE t.`teamId` = b.`teamId` AND json_extract(t.`assignment`, '$.build.agentId') = b.`id`) DESC,
    b.`id`
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM `routing_rule` r WHERE r.`teamId` = a.`teamId` AND r.`use` = 'session');--> statement-breakpoint
INSERT OR IGNORE INTO `work_policy` (`id`, `teamId`, `use`, `tools`, `mcpServers`, `skillsAllowlist`, `defaultSkill`, `secrets`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), r.`teamId`, 'session', a.`tools`, a.`mcpServers`, a.`skillsAllowlist`, a.`defaultSkill`, a.`secrets`, a.`id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `routing_rule` r JOIN `agent` a ON a.`id` = r.`seededFromAgentId` AND a.`teamId` = r.`teamId`
WHERE r.`use` = 'session'
AND NOT EXISTS (SELECT 1 FROM `work_policy` p WHERE p.`teamId` = r.`teamId` AND p.`use` = 'session');--> statement-breakpoint
INSERT OR IGNORE INTO `work_policy` (`id`, `teamId`, `use`, `tools`, `mcpServers`, `skillsAllowlist`, `defaultSkill`, `secrets`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), t.`id`, 'review',
  coalesce((SELECT json_group_array(j.`value`) FROM `agent` a, json_each(a.`tools`) j WHERE a.`teamId` = t.`id` AND a.`persona` = 'code_reviewer' AND j.`value` NOT IN ('合并分支', '推送分支', '创建标签', '创建技能', '更新技能')), '[]'),
  coalesce((SELECT a.`mcpServers` FROM `agent` a WHERE a.`teamId` = t.`id` AND a.`persona` = 'code_reviewer'), '[]'),
  (SELECT a.`skillsAllowlist` FROM `agent` a WHERE a.`teamId` = t.`id` AND a.`persona` = 'code_reviewer'),
  (SELECT a.`defaultSkill` FROM `agent` a WHERE a.`teamId` = t.`id` AND a.`persona` = 'code_reviewer'),
  '[]',
  (SELECT a.`id` FROM `agent` a WHERE a.`teamId` = t.`id` AND a.`persona` = 'code_reviewer'),
  CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `team` t
WHERE NOT EXISTS (SELECT 1 FROM `work_policy` p WHERE p.`teamId` = t.`id` AND p.`use` = 'review');--> statement-breakpoint
INSERT OR IGNORE INTO `routing_rule` (`id`, `teamId`, `use`, `provider`, `modelId`, `thinkingLevel`, `fallbackModels`, `machineId`, `requiredCapabilities`, `mcpServers`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT a.`id`, c.`teamId`, 'coordinator', a.`provider`, a.`modelId`, a.`thinkingLevel`, a.`fallbackModels`, a.`machineId`, a.`requiredCapabilities`, a.`mcpServers`, a.`id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `chief` c JOIN `agent` a ON a.`id` = c.`agentId`
WHERE a.`provider` IS NOT NULL AND a.`modelId` IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM `routing_rule` r WHERE r.`teamId` = c.`teamId` AND r.`use` = 'coordinator')
ORDER BY c.`id`;--> statement-breakpoint
INSERT OR IGNORE INTO `routing_rule` (`id`, `teamId`, `use`, `provider`, `modelId`, `thinkingLevel`, `fallbackModels`, `machineId`, `requiredCapabilities`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), a.`teamId`, 'citation_check', a.`provider`, a.`modelId`, a.`thinkingLevel`, a.`fallbackModels`, a.`machineId`, a.`requiredCapabilities`, a.`id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `agent` a
WHERE a.`id` = (
  SELECT b.`id` FROM `agent` b
  WHERE b.`teamId` = a.`teamId` AND b.`status` = 'active' AND b.`persona` IS NULL AND b.`provider` IS NOT NULL AND b.`modelId` IS NOT NULL
    AND b.`id` NOT IN (SELECT `agentId` FROM `chief` WHERE `agentId` IS NOT NULL)
  ORDER BY (b.`displayName` = 'eval-harbor') DESC, b.`id`
  LIMIT 1
)
AND EXISTS (SELECT 1 FROM `todo` t WHERE t.`teamId` = a.`teamId` AND t.`sourceKind` = 'research-citation-check')
AND NOT EXISTS (SELECT 1 FROM `routing_rule` r WHERE r.`teamId` = a.`teamId` AND r.`use` = 'citation_check');--> statement-breakpoint
INSERT OR IGNORE INTO `routing_rule` (`id`, `teamId`, `use`, `provider`, `modelId`, `thinkingLevel`, `fallbackModels`, `machineId`, `requiredCapabilities`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), a.`teamId`, 'session', a.`provider`, a.`modelId`, a.`thinkingLevel`, a.`fallbackModels`, a.`machineId`, a.`requiredCapabilities`, a.`id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `agent` a
WHERE a.`id` = (
  SELECT b.`id` FROM `agent` b
  WHERE b.`teamId` = a.`teamId` AND b.`provider` IS NOT NULL AND b.`modelId` IS NOT NULL
    AND b.`id` NOT IN (SELECT `agentId` FROM `chief` WHERE `agentId` IS NOT NULL)
    AND (SELECT count(*) FROM `todo` t WHERE t.`teamId` = b.`teamId` AND b.`id` IN (json_extract(t.`assignment`, '$.plan.agentId'), json_extract(t.`assignment`, '$.verify.agentId'))) > 0
  ORDER BY (SELECT count(*) FROM `todo` t WHERE t.`teamId` = b.`teamId` AND b.`id` IN (json_extract(t.`assignment`, '$.plan.agentId'), json_extract(t.`assignment`, '$.verify.agentId'))) DESC, b.`id`
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM `routing_rule` r WHERE r.`teamId` = a.`teamId` AND r.`use` = 'session');--> statement-breakpoint
INSERT OR IGNORE INTO `routing_rule` (`id`, `teamId`, `use`, `provider`, `modelId`, `thinkingLevel`, `fallbackModels`, `machineId`, `requiredCapabilities`, `seededFromAgentId`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), a.`teamId`, 'review', a.`provider`, a.`modelId`, a.`thinkingLevel`, a.`fallbackModels`, a.`machineId`, a.`requiredCapabilities`, a.`id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `agent` a
WHERE a.`id` = (
  SELECT b.`id` FROM `agent` b
  WHERE b.`teamId` = a.`teamId` AND b.`provider` IS NOT NULL AND b.`modelId` IS NOT NULL
    AND b.`id` NOT IN (SELECT `agentId` FROM `chief` WHERE `agentId` IS NOT NULL)
    AND (b.`persona` = 'code_reviewer' OR (SELECT count(*) FROM `todo` t WHERE t.`teamId` = b.`teamId` AND json_extract(t.`assignment`, '$.review.agentId') = b.`id`) > 0)
  ORDER BY (SELECT count(*) FROM `todo` t WHERE t.`teamId` = b.`teamId` AND json_extract(t.`assignment`, '$.review.agentId') = b.`id`) DESC,
    coalesce(b.`persona` = 'code_reviewer', 0) DESC, b.`id`
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM `routing_rule` r WHERE r.`teamId` = a.`teamId` AND r.`use` = 'review');--> statement-breakpoint
UPDATE `agent_memory` SET `independent` = 1 WHERE `agentId` IN (SELECT `id` FROM `agent` WHERE `persona` IN ('code_reviewer', 'security_auditor', 'test_engineer', 'verifier'));--> statement-breakpoint
INSERT INTO `agent_memory` (`id`, `agentId`, `teamId`, `title`, `content`, `projectId`, `sourceTodoId`, `sourceBuildId`, `source`, `layer`, `threadId`, `adoptedFrom`, `independent`, `history`, `invalidAt`, `supersededBy`, `lastInjectedAt`, `createdAt`, `updatedAt`)
SELECT lower(hex(randomblob(16))), r.`id`, m.`teamId`, m.`title`, m.`content`, m.`projectId`, m.`sourceTodoId`, m.`sourceBuildId`, m.`source`, m.`layer`, m.`threadId`, m.`id`, m.`independent`, m.`history`, NULL, NULL, NULL, m.`createdAt`, m.`updatedAt`
FROM `agent_memory` m JOIN `routing_rule` r ON r.`teamId` = m.`teamId` AND r.`use` = 'session'
WHERE m.`invalidAt` IS NULL
AND m.`independent` = 0
AND m.`agentId` IN (SELECT a.`id` FROM `agent` a WHERE a.`teamId` = m.`teamId` AND a.`id` NOT IN (SELECT `agentId` FROM `chief` WHERE `agentId` IS NOT NULL) AND coalesce(a.`persona`, '') NOT IN ('code_reviewer', 'security_auditor', 'test_engineer', 'verifier'))
AND NOT EXISTS (SELECT 1 FROM json_each(coalesce(r.`adoptedAgentIds`, '[]')) WHERE `value` = m.`agentId`)
AND NOT EXISTS (SELECT 1 FROM `agent_memory` x WHERE x.`adoptedFrom` = m.`id` AND x.`agentId` = r.`id`);--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `chief` DROP COLUMN `agentId`;--> statement-breakpoint
ALTER TABLE `routing_rule` DROP COLUMN `adoptedAgentIds`;--> statement-breakpoint
ALTER TABLE `todo` DROP COLUMN `assignment`;
