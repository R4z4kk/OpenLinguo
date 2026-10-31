CREATE TABLE `notice` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`reason` text NOT NULL,
	`explanation` text NOT NULL,
	`name` text,
	`email` text,
	`created_at` integer NOT NULL,
	`outcome` text,
	`reply` text,
	`decided_at` integer,
	FOREIGN KEY (`submission_id`) REFERENCES `submission`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notice_reason" CHECK("notice"."reason" in ('copyright', 'defamation', 'hate', 'personal-data', 'child-sexual-abuse', 'serious-offences', 'library-rules')),
	CONSTRAINT "notice_decision" CHECK(("notice"."outcome" is null and "notice"."reply" is null and "notice"."decided_at" is null) or ("notice"."outcome" in ('kept', 'removed') and "notice"."reply" is not null and "notice"."decided_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `notice_submission` ON `notice` (`submission_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`measure` text NOT NULL,
	`source` text NOT NULL,
	`ground` text NOT NULL,
	`facts` text NOT NULL,
	`explanation` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submission`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "decision_measure" CHECK("__new_decision"."measure" in ('rejected', 'removed')),
	CONSTRAINT "decision_source" CHECK("__new_decision"."source" in ('own-initiative', 'notice'))
);
--> statement-breakpoint
INSERT INTO `__new_decision`("id", "submission_id", "measure", "source", "ground", "facts", "explanation", "decided_at") SELECT "id", "submission_id", "measure", "source", "ground", "facts", "explanation", "decided_at" FROM `decision`;--> statement-breakpoint
DROP TABLE `decision`;--> statement-breakpoint
ALTER TABLE `__new_decision` RENAME TO `decision`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `decision_submission` ON `decision` (`submission_id`);