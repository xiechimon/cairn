CREATE TRIGGER `step_git_key_revoke_on_release` AFTER UPDATE OF `status` ON `step`
WHEN OLD.`status` = 'claimed' AND NEW.`status` <> 'claimed'
BEGIN
  DELETE FROM `api_key` WHERE `name` = 'git-step-' || OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `step_git_key_revoke_on_delete` AFTER DELETE ON `step`
BEGIN
  DELETE FROM `api_key` WHERE `name` = 'git-step-' || OLD.`id`;
END;--> statement-breakpoint
DELETE FROM `api_key`
WHERE `name` LIKE 'git-step-%'
  AND substr(`name`, 10) NOT IN (SELECT `id` FROM `step` WHERE `status` = 'claimed');
