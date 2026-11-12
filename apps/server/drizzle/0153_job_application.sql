CREATE TABLE `job_application` (
	`userId` text PRIMARY KEY NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
