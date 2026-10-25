CREATE INDEX `machine_online_lastSeenAt_idx` ON `machine` (`online`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `notification_type_readAt_idx` ON `notification` (`type`,`readAt`);--> statement-breakpoint
CREATE INDEX `schedule_nextRunAt_idx` ON `schedule` (`nextRunAt`);--> statement-breakpoint
CREATE INDEX `step_status_kind_idx` ON `step` (`status`,`kind`);--> statement-breakpoint
CREATE INDEX `step_buildId_status_idx` ON `step` (`buildId`,`status`);--> statement-breakpoint
CREATE INDEX `step_kind_idx` ON `step` (`kind`);--> statement-breakpoint
CREATE INDEX `todo_phase_idx` ON `todo` (`phase`);