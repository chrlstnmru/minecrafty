CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`actor_id` integer,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`instance_id` integer,
	`instance_name` text,
	`summary` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_instance_at` ON `audit_log` (`instance_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_at` ON `audit_log` (`at`);