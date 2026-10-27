CREATE TABLE `build_outcome_backfill` (
	`buildId` text PRIMARY KEY NOT NULL,
	`revertedWithin7d` integer NOT NULL,
	`fixedByLaterPr` integer NOT NULL,
	`mergeCommit` text NOT NULL,
	`checkedAt` integer NOT NULL,
	FOREIGN KEY (`buildId`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
