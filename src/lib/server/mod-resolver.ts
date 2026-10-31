import { basename } from 'node:path';
import * as modrinth from './modrinth';

/** Where versions come from: Modrinth, or a fake in a test. */
export type VersionSource = Pick<typeof modrinth, 'getVersion' | 'listVersions'>;

export type Planned = { version: modrinth.ModrinthVersion; dependencyOf: string | null };

/** Prefers a stable release over betas and alphas; versions arrive newest first. */
export const pickVersion = (versions: modrinth.ModrinthVersion[]) =>
	versions.find((v) => v.version_type === 'release') ?? versions[0];

/** The file to download for a version. Its name comes from a third party and is joined onto a path, so it must be a plain `.jar` name. */
export function pickFile(version: modrinth.ModrinthVersion) {
	const file = version.files.find((f) => f.primary) ?? version.files[0];
	if (!file) throw new Error(`Version ${version.version_number} has no files`);
	const name = basename(file.filename);
	if (name !== file.filename || name.startsWith('.') || !name.endsWith('.jar'))
		throw new Error(`Refusing unexpected file name "${file.filename}"`);
	return { ...file, filename: name };
}

/**
 * Works out which versions to add: the project plus every required dependency whose project is not
 * in `have`. A dependency with no compatible version is skipped; the project itself with none is an
 * error. `root` is a version chosen up front (a pinned version, or the new version of a mod that is
 * already present); the project is planned even when `have` lists it.
 *
 * `loader` is the name shown in errors; `loaders` are the loader names Modrinth should match.
 */
export async function resolveMods(
	target: { loader: string; loaders: string[]; mcVersion: string },
	have: ReadonlySet<string>,
	projectId: string,
	opts: { root?: modrinth.ModrinthVersion; source?: VersionSource } = {}
) {
	const { root, source = modrinth } = opts;
	const present = new Set(have);
	if (root) present.delete(projectId);
	const planned = new Map<string, Planned>();
	const skipped: string[] = [];
	const queue: { projectId: string | null; versionId: string | null; parent: string | null }[] = [
		{ projectId, versionId: root?.id ?? null, parent: null }
	];

	while (queue.length) {
		const next = queue.shift()!;
		let version: modrinth.ModrinthVersion | undefined;
		if (root && next.versionId === root.id) version = root;
		else if (next.versionId) version = await source.getVersion(next.versionId);
		else if (next.projectId)
			version = pickVersion(
				await source.listVersions(next.projectId, target.loaders, target.mcVersion)
			);
		const id = next.projectId ?? version?.project_id;
		if (!id || present.has(id) || planned.has(id)) continue;

		if (!version) {
			if (!next.parent)
				throw new Error(`No ${target.loader} version for Minecraft ${target.mcVersion} was found`);
			skipped.push(id);
			continue;
		}
		planned.set(id, { version, dependencyOf: next.parent });
		for (const dep of version.dependencies) {
			if (dep.dependency_type === 'required')
				queue.push({ projectId: dep.project_id, versionId: dep.version_id, parent: id });
		}
	}
	return { planned, skipped };
}
