CREATE TABLE `todo_transition` (
	`id` text PRIMARY KEY NOT NULL,
	`todoId` text NOT NULL,
	`fromPhase` text NOT NULL,
	`toPhase` text NOT NULL,
	`cause` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`todoId`) REFERENCES `todo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `todo_transition_todo_idx` ON `todo_transition` (`todoId`,`at`);