// The folders a pack keeps its config files in, as a .mrpack has them. Every config path starts
// with one of them: `overrides/config/a.toml`.

export const CONFIG_SIDES = ['overrides', 'server-overrides', 'client-overrides'] as const;

export type ConfigSide = (typeof CONFIG_SIDES)[number];

/** What each folder is for, as the Configs tab says it. */
export const SIDE_HINTS: Record<ConfigSide, string> = {
	overrides: 'Goes to servers and players.',
	'server-overrides': 'Goes to servers only, and replaces the same file from overrides.',
	'client-overrides': 'Goes to players only.'
};

/** Where a new file goes when no folder is picked. */
export const DEFAULT_SIDE: ConfigSide = 'overrides';

/** Whether `path` is one of the three folders themselves, which always exist. */
export const isSide = (path: string): path is ConfigSide =>
	(CONFIG_SIDES as readonly string[]).includes(path);

/** The folder `path` is in, or undefined when it is in none of them. */
const sideOf = (path: string): ConfigSide | undefined => {
	const top = path.split('/')[0];
	return isSide(top) ? top : undefined;
};

/** Whether `path` is a file or folder inside one of the three folders (not one of them). */
export const inSide = (path: string) => sideOf(path) !== undefined && !isSide(path);

/** The path of the same file in `server-overrides`, for one in `overrides`; undefined otherwise. */
export const serverCopyOf = (path: string) =>
	sideOf(path) === 'overrides' ? `server-overrides${path.slice('overrides'.length)}` : undefined;
