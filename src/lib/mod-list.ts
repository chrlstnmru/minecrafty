/** What the installed-mod lists show and filter: one shape for an instance's mods and a pack's. */

export type Side = string | null;

export type ModListItem = {
	/** unique in the list */
	key: string;
	/** the installed mod's or pack file's id; null for a jar the panel did not install */
	id: number | null;
	projectId: string | null;
	title: string;
	iconUrl: string | null;
	/** path of the jar, relative to the server folder or the pack */
	file: string;
	versionNumber: string | null;
	versionId: string | null;
	/** project id of the mod that pulled this one in */
	dependencyOf: string | null;
	clientSide: Side;
	serverSide: Side;
	/** false only for an instance's disabled jars; packs have no switch */
	enabled: boolean;
	/** whether Modrinth knows it, so it has versions, updates and a project page; otherwise it is Local */
	fromModrinth: boolean;
	update?: { versionNumber: string };
};

export type SideTag = 'server' | 'client';

/** The sides a mod runs on, server first; nothing while the project has not said. */
export function sideTags(clientSide: Side, serverSide: Side): SideTag[] {
	if (!clientSide || !serverSide) return [];
	const tags: SideTag[] = [];
	if (serverSide !== 'unsupported') tags.push('server');
	if (clientSide !== 'unsupported') tags.push('client');
	return tags;
}

export const MOD_FILTERS = ['all', 'updates', 'disabled', 'client-only', 'local'] as const;
export type ModFilter = (typeof MOD_FILTERS)[number];

const inFilter: Record<ModFilter, (item: ModListItem) => boolean> = {
	all: () => true,
	updates: (item) => !!item.update,
	disabled: (item) => !item.enabled,
	'client-only': (item) => item.serverSide === 'unsupported',
	local: (item) => !item.fromModrinth
};

export function countByFilter(items: ModListItem[]): Record<ModFilter, number> {
	return Object.fromEntries(
		MOD_FILTERS.map((filter) => [filter, items.filter(inFilter[filter]).length])
	) as Record<ModFilter, number>;
}

/** The items in `filter` whose title or file contains every word of `query`, ignoring case. */
export function filterMods(items: ModListItem[], filter: ModFilter, query: string) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return items.filter((item) => {
		if (!inFilter[filter](item)) return false;
		const text = `${item.title} ${item.file}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

/** Why a mod is in the list, when it is not simply one somebody chose. */
export function reason(item: ModListItem, titles: Map<string, string>): string | null {
	if (!item.dependencyOf) return null;
	const parent = titles.get(item.dependencyOf);
	return parent ? `Required by ${parent}` : 'Added as a dependency';
}
