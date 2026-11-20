UPDATE `project` SET `localPath` = NULL WHERE `repoKind` = 'github' AND `localPath` IS NOT NULL;
