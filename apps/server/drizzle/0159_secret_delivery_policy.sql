ALTER TABLE `secret` ADD `delivery` text DEFAULT 'plaintext' NOT NULL;--> statement-breakpoint
ALTER TABLE `secret` ADD `httpOrigin` text;--> statement-breakpoint
ALTER TABLE `secret` ADD `httpHeader` text;--> statement-breakpoint
ALTER TABLE `secret` ADD `httpTemplate` text;--> statement-breakpoint
ALTER TABLE `secret` ADD `policyRevision` integer DEFAULT 1 NOT NULL CONSTRAINT "secret_delivery_policy" CHECK(("delivery" = 'http' AND "httpOrigin" IS NOT NULL AND "httpHeader" IS NOT NULL AND "httpTemplate" IS NOT NULL) OR ("delivery" = 'plaintext' AND "httpOrigin" IS NULL AND "httpHeader" IS NULL AND "httpTemplate" IS NULL));
