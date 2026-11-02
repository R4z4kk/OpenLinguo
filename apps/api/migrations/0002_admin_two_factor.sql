CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_user_id` ON `two_factor` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_security_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`method` text NOT NULL,
	`user_id` text,
	`ip_address` text,
	`user_agent` text,
	`reason` text,
	`target` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "security_event_type" CHECK("__new_security_event"."type" in ('sign_in', 'sign_in_failed', 'code_sent', 'second_factor', 'second_factor_failed', 'admin_action'))
);
--> statement-breakpoint
INSERT INTO `__new_security_event`("id", "type", "method", "user_id", "ip_address", "user_agent", "reason", "created_at") SELECT "id", "type", "method", "user_id", "ip_address", "user_agent", "reason", "created_at" FROM `security_event`;--> statement-breakpoint
DROP TABLE `security_event`;--> statement-breakpoint
ALTER TABLE `__new_security_event` RENAME TO `security_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `session` ADD `impersonated_by` text;--> statement-breakpoint
ALTER TABLE `session` ADD `two_factor_verified_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `two_factor_enabled` integer DEFAULT false;