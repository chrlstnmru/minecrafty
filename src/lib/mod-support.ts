// Modrinth loader tags an instance's loader can run; Quilt runs Fabric mods, Purpur runs Paper plugins
const COMPATIBLE_LOADERS: Record<string, string[]> = {
	fabric: ['fabric'],
	quilt: ['quilt', 'fabric'],
	forge: ['forge'],
	neoforge: ['neoforge'],
	paper: ['paper', 'spigot', 'bukkit'],
	purpur: ['purpur', 'paper', 'spigot', 'bukkit']
};

const PLUGIN_LOADERS = new Set(['paper', 'purpur']);

/** What a loader can install. Plain data, so the page can work it out without asking the server. */
export function modSupport(loader: string) {
	const loaders = COMPATIBLE_LOADERS[loader];
	return {
		supported: !!loaders,
		loaders: loaders ?? [],
		// Paper-family servers load plugins, everything else loads mods
		noun: PLUGIN_LOADERS.has(loader) ? 'plugin' : 'mod',
		folder: PLUGIN_LOADERS.has(loader) ? 'plugins' : 'mods'
	};
}
