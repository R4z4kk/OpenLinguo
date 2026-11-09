CREATE TABLE `account_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ground` text NOT NULL,
	`facts` text NOT NULL,
	`explanation` text NOT NULL,
	`ends_at` integer,
	`lifted_at` integer,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_decision_user` ON `account_decision` (`user_id`);