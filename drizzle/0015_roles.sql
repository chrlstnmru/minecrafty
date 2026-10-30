CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rules` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
INSERT INTO `roles` (`name`, `description`, `rules`, `built_in`) VALUES
	('Viewer', 'See the server and read its logs', '{"allow":["view","logs"],"deny":[],"lockedProperties":[],"lockedSettings":[]}', 1),
	('Operator', 'Run the server and use the console', '{"allow":["view","logs","console","control"],"deny":[],"lockedProperties":[],"lockedSettings":[]}', 1),
	('Manager', 'Everything except settings', '{"allow":["view","logs","console","control","files","mods","backups","schedules"],"deny":[],"lockedProperties":[],"lockedSettings":[]}', 1),
	('Full', 'Everything on the server', '{"allow":["view","logs","console","control","files","mods","backups","schedules","settings"],"deny":[],"lockedProperties":[],"lockedSettings":[]}', 1);--> statement-breakpoint
-- grants kept a plain list before; viewing a server used to include its logs, so the list gains "logs"
CREATE TEMP TABLE `old_grants` AS
	SELECT `user_id`, `instance_id`, replace(`permissions`, '"view"', '"view","logs"') AS `list` FROM `instance_permissions`;--> statement-breakpoint
INSERT INTO `roles` (`name`, `description`, `rules`, `built_in`)
	SELECT 'Imported access ' || row_number() OVER (ORDER BY `list`), 'Made from the access given before roles existed',
		'{"allow":' || `list` || ',"deny":[],"lockedProperties":[],"lockedSettings":[]}', 0
	FROM (SELECT DISTINCT `list` FROM `old_grants`)
	WHERE NOT EXISTS (SELECT 1 FROM `roles` WHERE json_extract(`roles`.`rules`, '$.allow') = `list`);--> statement-breakpoint
DROP TABLE `instance_permissions`;--> statement-breakpoint
CREATE TABLE `instance_permissions` (
	`user_id` integer NOT NULL,
	`instance_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `instance_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `instance_permissions` (`user_id`, `instance_id`, `role_id`)
	SELECT `user_id`, `instance_id`,
		(SELECT min(`id`) FROM `roles` WHERE json_extract(`roles`.`rules`, '$.allow') = `list`)
	FROM `old_grants`;--> statement-breakpoint
DROP TABLE `old_grants`;
