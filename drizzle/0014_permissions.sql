CREATE TABLE `instance_permissions` (
	`user_id` integer NOT NULL,
	`instance_id` integer NOT NULL,
	`permissions` text NOT NULL,
	PRIMARY KEY(`user_id`, `instance_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
