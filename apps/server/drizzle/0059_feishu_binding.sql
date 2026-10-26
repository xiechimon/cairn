CREATE TABLE `feishu_binding` (
	`teamId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`openId` text NOT NULL,
	`cairnOrigin` text NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feishu_binding_openId_unique` ON `feishu_binding` (`openId`);