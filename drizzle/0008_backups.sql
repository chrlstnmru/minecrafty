CREATE TABLE `backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`file` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backups_instance` ON `backups` (`instance_id`);--> statement-breakpoint
ALTER TABLE `instances` ADD `backup_keep` integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE `instances` ADD `backup_excludes` text DEFAULT 'logs
crash-reports' NOT NULL;