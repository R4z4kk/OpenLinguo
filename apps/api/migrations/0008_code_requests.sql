CREATE TABLE `code_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `code_request_email_hash` ON `code_request` (`email_hash`,`created_at`);