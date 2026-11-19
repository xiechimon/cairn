CREATE TRIGGER `step_bg_task_orphan_on_release` AFTER UPDATE OF `status` ON `step`
WHEN OLD.`status` = 'claimed' AND NEW.`status` <> 'claimed'
BEGIN
  UPDATE `message`
  SET `content` = json_set(
    `content`,
    '$.task.status', 'orphaned',
    '$.task.endedAt', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  WHERE `id` >= 'bg-' || OLD.`id` || '-'
    AND `id` < 'bg-' || OLD.`id` || '.'
    AND json_extract(`content`, '$.kind') = 'bg_task'
    AND json_extract(`content`, '$.task.status') = 'running';
END;
