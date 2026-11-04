UPDATE `agent` SET `tools` = json_insert(`tools`, '$[#]', '推送分支') WHERE NOT EXISTS (SELECT 1 FROM json_each(`agent`.`tools`) WHERE `value` = '推送分支');
