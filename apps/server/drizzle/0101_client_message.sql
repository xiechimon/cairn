CREATE TABLE `client_message` (
	`scopeId` text NOT NULL,
	`clientMessageId` text NOT NULL,
	`response` text,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`scopeId`, `clientMessageId`)
);
