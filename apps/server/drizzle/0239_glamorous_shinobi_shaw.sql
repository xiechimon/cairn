DROP TABLE `autonomy_state`;--> statement-breakpoint
DROP TABLE `member_activity`;--> statement-breakpoint
DROP TABLE `schedule_report`;--> statement-breakpoint
DELETE FROM `due_event` WHERE `id` IN ('poll:intake', 'poll:scheduling');