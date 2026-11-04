DROP TABLE `shell_command`;--> statement-breakpoint
DROP TABLE `webhook_token`;--> statement-breakpoint
DROP TABLE `whats_new`;--> statement-breakpoint
ALTER TABLE `machine` DROP COLUMN `shellEnabled`;--> statement-breakpoint
UPDATE `agent`
SET `tools` = (
  SELECT COALESCE(json_group_array(value), '[]')
  FROM json_each(`tools`)
  WHERE value != '远程 shell'
)
WHERE EXISTS (
  SELECT 1 FROM json_each(`tools`) WHERE value = '远程 shell'
);