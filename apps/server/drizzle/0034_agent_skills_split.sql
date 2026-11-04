ALTER TABLE `agent` ADD `defaultSkill` text;--> statement-breakpoint
ALTER TABLE `agent` ADD `skillsAllowlist` text;
--> statement-breakpoint
UPDATE `agent` SET
  `defaultSkill` = json_extract(`skills`, '$[0]'),
  `skillsAllowlist` = CASE WHEN json_array_length(`skills`) = 0 THEN NULL ELSE `skills` END;
--> statement-breakpoint
ALTER TABLE `agent` DROP COLUMN `skills`;