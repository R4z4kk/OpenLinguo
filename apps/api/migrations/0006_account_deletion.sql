CREATE TABLE `erasure` (
	`user_id` text PRIMARY KEY NOT NULL,
	`published` text NOT NULL,
	`ip_address` text,
	`protocol` text,
	`erased_at` integer NOT NULL,
	CONSTRAINT "erasure_published" CHECK("erasure"."published" in ('keep-named', 'keep-anonymous', 'remove'))
);
--> statement-breakpoint
CREATE TABLE `sealed_identity` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_until` integer NOT NULL,
	`pseudonyms` text,
	`pseudonyms_until` integer NOT NULL,
	`sealed_at` integer NOT NULL
);
