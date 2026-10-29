CREATE TABLE `installed_mods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`kind` text DEFAULT 'mod' NOT NULL,
	`source` text NOT NULL,
	`project_id` text NOT NULL,
	`version_id` text NOT NULL,
	`title` text NOT NULL,
	`icon_url` text,
	`version_number` text NOT NULL,
	`file` text NOT NULL,
	`hash` text,
	`dependency_of` text,
	`installed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installed_mods_project` ON `installed_mods` (`instance_id`,`kind`,`source`,`project_id`);--> statement-breakpoint
CREATE INDEX `installed_mods_instance` ON `installed_mods` (`instance_id`);