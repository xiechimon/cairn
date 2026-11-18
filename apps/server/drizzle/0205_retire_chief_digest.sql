UPDATE `step` SET `status`='stopped', `finishedAt`=CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE `kind`='chief' AND `status` IN ('pending','claimed') AND `buildId` LIKE 'chief-digest-%';
--> statement-breakpoint
DELETE FROM `routing_rule` WHERE `use`='digest';
--> statement-breakpoint
DROP TABLE `chief_summary`;