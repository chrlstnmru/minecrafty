-- the four roles that came with the panel are gone: people make their own
DELETE FROM `role_assignments` WHERE `role_id` IN (SELECT `id` FROM `roles` WHERE `built_in` = 1);--> statement-breakpoint
DELETE FROM `roles` WHERE `built_in` = 1;--> statement-breakpoint
ALTER TABLE `roles` DROP COLUMN `built_in`;
