CREATE TABLE `computer_browser_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`computerId` text NOT NULL,
	`profileKey` text NOT NULL,
	`stepId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`fence` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`computerId`) REFERENCES `computer`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `computer_browser_lease_profile_idx` ON `computer_browser_lease` (`computerId`,`profileKey`);--> statement-breakpoint
CREATE INDEX `computer_browser_lease_step_idx` ON `computer_browser_lease` (`stepId`);