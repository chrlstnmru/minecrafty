import { modSupport } from '#lib/mod-support.js';

import { resolveMods } from './mod-resolver';
import * as modrinth from './modrinth';

// What can run here: search, version lists, one version and dependency plans, for a target that an
// instance and a pack build the same way, so Quilt matches Fabric mods in both.

export type ModTarget = {
	/** the name shown in errors */
	loader: string;
	/** the loader names Modrinth should match */
	loaders: string[];
	plugins: boolean;
	mcVersion: string;
};

export function modTarget({ loader, mcVersion }: { loader: string; mcVersion: string }): ModTarget {
	const support = modSupport(loader);
	return { loader, loaders: support.loaders, plugins: support.noun === 'plugin', mcVersion };
}

/** One version as the version pickers show it. */
export const versionChoice = (v: modrinth.ModrinthVersion) => ({
	id: v.id,
	versionNumber: v.version_number,
	versionType: v.version_type,
	publishedAt: v.date_published
});

export async function searchMods(target: ModTarget, query: string, limit: number) {
	const res = await modrinth.searchProjects({
		query,
		loaders: target.loaders,
		plugins: target.plugins,
		mc: target.mcVersion,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

/** Every version of a project that runs here, newest first. */
export const compatibleVersions = (target: ModTarget, projectId: string) =>
	modrinth.listVersions(projectId, target.loaders, target.mcVersion);

/** Looks the version up among the compatible ones, so only versions that run here can be chosen. */
export async function findVersion(target: ModTarget, projectId: string, versionId: string) {
	const version = (await compatibleVersions(target, projectId)).find((v) => v.id === versionId);
	if (!version)
		throw new Error(`That version does not run on ${target.loader} ${target.mcVersion}`);
	return version;
}

/** Which versions to add: the project plus every required dependency whose project is not in `have`. */
export const planMods = (
	target: ModTarget,
	have: ReadonlySet<string>,
	projectId: string,
	root?: modrinth.ModrinthVersion
) => resolveMods(target, have, projectId, { root });
