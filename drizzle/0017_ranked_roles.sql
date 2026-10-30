CREATE TABLE `role_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	`instance_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_assignments_unique` ON `role_assignments` (`user_id`,`role_id`,`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `role_assignments_panel_unique` ON `role_assignments` (`user_id`,`role_id`) WHERE `instance_id` IS NULL;--> statement-breakpoint
INSERT INTO `role_assignments` (`user_id`, `role_id`, `instance_id`)
	SELECT `user_id`, `role_id`, `instance_id` FROM `instance_permissions`;--> statement-breakpoint
DROP TABLE `instance_permissions`;--> statement-breakpoint
DROP INDEX `roles_name_unique`;--> statement-breakpoint
ALTER TABLE `roles` ADD `rank` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_active` ON `roles` (`name`) WHERE "roles"."deleted_at" is null;
--> statement-breakpoint
UPDATE `roles` SET `rank` = CASE `name` WHEN 'Viewer' THEN 10 WHEN 'Operator' THEN 30 WHEN 'Manager' THEN 60 WHEN 'Full' THEN 90 ELSE 20 END;
--> statement-breakpoint
UPDATE `roles` SET `description` = 'Everything except the loader and settings' WHERE `built_in` = 1 AND `name` = 'Manager';
