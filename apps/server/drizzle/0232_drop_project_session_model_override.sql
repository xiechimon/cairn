UPDATE `project` SET `modelOverrides` = json_remove(`modelOverrides`, '$.session') WHERE json_type(`modelOverrides`, '$.session') IS NOT NULL;
