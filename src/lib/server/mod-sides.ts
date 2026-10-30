import * as modrinth from './modrinth';

export type Sides = { clientSide: string; serverSide: string };

const BATCH = 100;

/** Where each project says it runs, by project id. Projects Modrinth no longer lists are absent. */
export async function projectSides(projectIds: string[]) {
	const sides = new Map<string, Sides>();
	const ids = [...new Set(projectIds)];
	for (let i = 0; i < ids.length; i += BATCH)
		for (const project of await modrinth.getProjects(ids.slice(i, i + BATCH)))
			sides.set(project.id, { clientSide: project.client_side, serverSide: project.server_side });
	return sides;
}

type PackFile = { path: string; hashes: { sha512?: string } };

/**
 * The files of a modpack whose project says it does not run on a server, as path to project
 * title, unless a mod that stays requires it. The pack's own `env` flags cannot be trusted for
 * this: packs tend to mark every file as required on both sides. A lookup that fails flags nothing, so an unreachable Modrinth never
 * hides a mod.
 */
export async function clientOnlyFiles(files: PackFile[]) {
	const flagged = new Map<string, string>();
	const jars = files.filter(
		(f) => /^(mods|plugins)\//.test(f.path) && f.path.endsWith('.jar') && f.hashes.sha512
	);
	if (!jars.length) return flagged;
	try {
		const versions = new Map<string, modrinth.ModrinthVersion>();
		for (let i = 0; i < jars.length; i += BATCH)
			Object.entries(
				await modrinth.versionsByHashes(jars.slice(i, i + BATCH).map((f) => f.hashes.sha512!))
			).forEach(([hash, version]) => versions.set(hash, version));

		const ids = [...new Set([...versions.values()].map((v) => v.project_id))];
		const titles = new Map<string, string>();
		const sides = new Map<string, Sides>();
		for (let i = 0; i < ids.length; i += BATCH)
			for (const project of await modrinth.getProjects(ids.slice(i, i + BATCH))) {
				titles.set(project.id, project.title);
				sides.set(project.id, {
					clientSide: project.client_side,
					serverSide: project.server_side
				});
			}
		const skip = new Set(ids.filter((id) => sides.get(id)?.serverSide === 'unsupported'));
		// a mod that stays may need one flagged as client-only; that one stays too, or the
		// loader stops at startup with a missing dependency (and what it needs follows suit)
		const requires = new Map<string, string[]>();
		for (const version of versions.values())
			requires.set(version.project_id, [
				...(requires.get(version.project_id) ?? []),
				...(version.dependencies ?? [])
					.filter((d) => d.dependency_type === 'required' && d.project_id)
					.map((d) => d.project_id!)
			]);
		const pending = ids.filter((id) => !skip.has(id));
		for (let id = pending.pop(); id; id = pending.pop())
			for (const needed of requires.get(id) ?? []) if (skip.delete(needed)) pending.push(needed);

		for (const file of jars) {
			const projectId = versions.get(file.hashes.sha512!)?.project_id;
			if (projectId && skip.has(projectId))
				flagged.set(file.path, titles.get(projectId) ?? file.path);
		}
	} catch {
		return new Map();
	}
	return flagged;
}
