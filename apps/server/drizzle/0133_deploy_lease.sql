CREATE TABLE `deploy_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`status` text NOT NULL,
	`expiresAt` integer NOT NULL,
	CONSTRAINT "deploy_lease_status" CHECK("deploy_lease"."status" in ('accepting', 'draining'))
);
