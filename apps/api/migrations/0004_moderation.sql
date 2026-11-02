CREATE TABLE `decision` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`measure` text NOT NULL,
	`source` text NOT NULL,
	`ground` text NOT NULL,
	`facts` text NOT NULL,
	`explanation` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submission`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "decision_measure" CHECK("decision"."measure" in ('rejected', 'removed')),
	CONSTRAINT "decision_source" CHECK("decision"."source" in ('own-initiative'))
);
--> statement-breakpoint
CREATE INDEX `decision_submission` ON `decision` (`submission_id`);--> statement-breakpoint
ALTER TABLE `submission` ADD `band` integer;--> statement-breakpoint
ALTER TABLE `submission` ADD `published_at` integer;