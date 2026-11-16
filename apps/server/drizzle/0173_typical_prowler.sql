PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_secret` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`projectId` text,
	`name` text NOT NULL,
	`description` text,
	`valueCipher` text,
	`delivery` text DEFAULT 'plaintext' NOT NULL,
	`httpOrigin` text,
	`httpHeader` text,
	`httpTemplate` text,
	`browserOrigin` text,
	`browserMachineId` text,
	`policyRevision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "secret_delivery_policy" CHECK(("__new_secret"."delivery" = 'http' AND "__new_secret"."httpOrigin" IS NOT NULL AND "__new_secret"."httpHeader" IS NOT NULL AND "__new_secret"."httpTemplate" IS NOT NULL AND "__new_secret"."browserOrigin" IS NULL AND "__new_secret"."browserMachineId" IS NULL) OR ("__new_secret"."delivery" = 'plaintext' AND "__new_secret"."httpOrigin" IS NULL AND "__new_secret"."httpHeader" IS NULL AND "__new_secret"."httpTemplate" IS NULL AND "__new_secret"."browserOrigin" IS NULL AND "__new_secret"."browserMachineId" IS NULL) OR ("__new_secret"."delivery" = 'browser' AND "__new_secret"."browserOrigin" IS NOT NULL AND "__new_secret"."projectId" IS NULL AND "__new_secret"."httpOrigin" IS NULL AND "__new_secret"."httpHeader" IS NULL AND "__new_secret"."httpTemplate" IS NULL AND (("__new_secret"."browserOrigin" GLOB 'http*://localhost' OR "__new_secret"."browserOrigin" GLOB 'http*://localhost:*' OR "__new_secret"."browserOrigin" GLOB 'http*://127.0.0.1' OR "__new_secret"."browserOrigin" GLOB 'http*://127.0.0.1:*' OR "__new_secret"."browserOrigin" LIKE 'http%://[::1]' OR "__new_secret"."browserOrigin" LIKE 'http%://[::1]:%') = ("__new_secret"."browserMachineId" IS NOT NULL))))
);
--> statement-breakpoint
INSERT INTO `__new_secret`("id", "teamId", "projectId", "name", "description", "valueCipher", "delivery", "httpOrigin", "httpHeader", "httpTemplate", "policyRevision") SELECT "id", "teamId", "projectId", "name", "description", "valueCipher", "delivery", "httpOrigin", "httpHeader", "httpTemplate", "policyRevision" FROM `secret`;--> statement-breakpoint
DROP TABLE `secret`;--> statement-breakpoint
ALTER TABLE `__new_secret` RENAME TO `secret`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
