UPDATE `todo` SET `phase` = 'stopped', `v` = `v` + 1
WHERE `phase` = 'todo'
  AND `latestBuildId` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `build` WHERE `build`.`id` = `todo`.`latestBuildId` AND `build`.`errorMessage` = '已取消'
  )
  AND EXISTS (SELECT 1 FROM `step` WHERE `step`.`buildId` = `todo`.`latestBuildId`)
  AND NOT EXISTS (
    SELECT 1 FROM `step` WHERE `step`.`buildId` = `todo`.`latestBuildId` AND `step`.`status` <> 'stopped'
  );
