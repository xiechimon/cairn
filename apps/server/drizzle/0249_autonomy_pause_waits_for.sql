ALTER TABLE `autonomy_pause` ADD `resolvedReason` text;--> statement-breakpoint
ALTER TABLE `autonomy_pause` ADD `waitsFor` text;--> statement-breakpoint
UPDATE `autonomy_pause`
SET `waitsFor` = json_object('kind', 'main-green', 'repo', substr(`requestKey`, 10, length(`requestKey`) - 50), 'failedSha', substr(`requestKey`, -40))
WHERE `source` = 'main-red'
  AND `requestKey` GLOB 'main-red:?*/?*:*'
  AND substr(`requestKey`, -41, 1) = ':'
  AND substr(`requestKey`, -40) NOT GLOB '*[^0-9a-fA-F]*'
  AND substr(`requestKey`, 10, length(`requestKey`) - 50) NOT GLOB '*[^A-Za-z0-9._/-]*'
  AND substr(`requestKey`, 10, length(`requestKey`) - 50) NOT GLOB '*/*/*';
