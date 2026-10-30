CREATE TABLE `local_pack_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pack_id` integer NOT NULL,
	`project_id` text,
	`version_id` text,
	`version_number` text,
	`title` text NOT NULL,
	`icon_url` text,
	`path` text NOT NULL,
	`downloads` text NOT NULL,
	`sha1` text,
	`sha512` text,
	`size` integer,
	`client_side` text,
	`server_side` text,
	`dependency_of` text,
	FOREIGN KEY (`pack_id`) REFERENCES `local_packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_pack_files_path` ON `local_pack_files` (`pack_id`,`path`);--> statement-breakpoint
CREATE TABLE `local_packs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`loader` text NOT NULL,
	`loader_version` text,
	`mc_version` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `instances` ADD `from_pack_id` integer;--> statement-breakpoint
ALTER TABLE `instances` ADD `from_pack_revision` integer;