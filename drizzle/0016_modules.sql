-- permissions follow the instance tabs now: files also opened Properties, mods also opened Modpack
-- and Resource packs, console also opened Players, settings also opened Loader; locks are gone
UPDATE `roles` SET `rules` = json_object(
	'allow', json(replace(replace(replace(replace(json_extract(`rules`, '$.allow'),
		'"files"', '"files","properties"'),
		'"mods"', '"mods","modpack","resource-packs"'),
		'"console"', '"console","players"'),
		'"settings"', '"settings","loader"')),
	'deny', json(replace(replace(replace(replace(coalesce(json_extract(`rules`, '$.deny'), '[]'),
		'"files"', '"files","properties"'),
		'"mods"', '"mods","modpack","resource-packs"'),
		'"console"', '"console","players"'),
		'"settings"', '"settings","loader"'))
);
--> statement-breakpoint
UPDATE `roles` SET `description` = 'Everything except the loader and settings' WHERE `built_in` = 1 AND `name` = 'Manager';
