ALTER TABLE `instances` ADD `install_state` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `instances` ADD `install_message` text;