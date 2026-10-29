CREATE TABLE `instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`loader` text NOT NULL,
	`mc_version` text NOT NULL,
	`port` integer NOT NULL,
	`ram_min_mb` integer DEFAULT 1024 NOT NULL,
	`ram_max_mb` integer DEFAULT 2048 NOT NULL,
	`jvm_args` text DEFAULT '' NOT NULL,
	`auto_start` integer DEFAULT false NOT NULL,
	`eula_accepted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_port_unique` ON `instances` (`port`);