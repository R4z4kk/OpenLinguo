CREATE TABLE `hosting_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`operation` text NOT NULL,
	`ip_address` text,
	`port` integer,
	`protocol` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "hosting_record_operation" CHECK("hosting_record"."operation" in ('create', 'edit', 'delete'))
);
--> statement-breakpoint
CREATE TABLE `submission` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`origin` text NOT NULL,
	`provenance` text,
	`licence` text NOT NULL,
	`attribution` text,
	`attestation_version` integer NOT NULL,
	`attested_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "submission_origin" CHECK(("submission"."origin" = 'human' and "submission"."provenance" is null and "submission"."licence" = 'CC-BY-SA-4.0') or ("submission"."origin" = 'ai' and "submission"."provenance" is not null and "submission"."licence" = 'CC0-1.0')),
	CONSTRAINT "submission_status" CHECK("submission"."status" in ('pending', 'approved', 'rejected', 'removed'))
);
--> statement-breakpoint
CREATE INDEX `submission_user_status` ON `submission` (`user_id`,`status`);