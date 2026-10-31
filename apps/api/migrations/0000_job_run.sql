CREATE TABLE `job_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT "job_run_status" CHECK("job_run"."status" in ('succeeded', 'failed'))
);
