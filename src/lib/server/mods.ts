import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { installedMods } from './db/schema';
import { downloadFile } from './download';
import { getInstance, serverDir, type Instance } from './instances';
import * as modrinth from './modrinth';

export type InstalledMod = typeof installedMods.$inferSelect;

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

function requireInstance(instanceId: number): Instance {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	if (!modSupport(inst.loader).supported)
		throw new Error(`${inst.loader} servers do not support mods or plugins`);
	return inst;
}

export function listInstalled(instanceId: number) {
	return db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, 'mod')))
		.orderBy(installedMods.title)
		.all();
}

export async function search(instanceId: number, query: string, limit: number) {
	const inst = requireInstance(instanceId);
	const res = await modrinth.searchProjects({
		query,
		loaders: modSupport(inst.loader).loaders,
		plugins: PLUGIN_LOADERS.has(inst.loader),
		mc: inst.mcVersion,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

/** Prefers a stable release over betas and alphas; versions arrive newest first. */
function pickVersion(versions: modrinth.ModrinthVersion[]) {
	return versions.find((v) => v.version_type === 'release') ?? versions[0];
}

function pickFile(version: modrinth.ModrinthVersion) {
	const file = version.files.find((f) => f.primary) ?? version.files[0];
	if (!file) throw new Error(`Version ${version.version_number} has no files`);
	// the name comes from a third party and is joined onto a path
	const name = basename(file.filename);
	if (name !== file.filename || name.startsWith('.') || !name.endsWith('.jar'))
		throw new Error(`Refusing unexpected file name "${file.filename}"`);
	return { ...file, filename: name };
}

type Planned = { version: modrinth.ModrinthVersion; dependencyOf: string | null };

/**
 * Works out which versions to install: the requested project plus every required
 * dependency that isn't installed yet. Dependencies with no compatible version are skipped.
 */
async function plan(inst: Instance, projectId: string) {
	const { loaders } = modSupport(inst.loader);
	const have = new Set(listInstalled(inst.id).map((m) => m.projectId));
	const planned = new Map<string, Planned>();
	const skipped: string[] = [];
	const queue: { projectId: string | null; versionId: string | null; parent: string | null }[] = [
		{ projectId, versionId: null, parent: null }
	];

	while (queue.length) {
		const next = queue.shift()!;
		let version: modrinth.ModrinthVersion | undefined;
		if (next.versionId) version = await modrinth.getVersion(next.versionId);
		else if (next.projectId)
			version = pickVersion(await modrinth.listVersions(next.projectId, loaders, inst.mcVersion));
		const id = next.projectId ?? version?.project_id;
		if (!id || have.has(id) || planned.has(id)) continue;

		if (!version) {
			if (!next.parent)
				throw new Error(`No ${inst.loader} version for Minecraft ${inst.mcVersion} was found`);
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

export async function install(instanceId: number, projectId: string) {
	const inst = requireInstance(instanceId);
	if (listInstalled(instanceId).some((m) => m.projectId === projectId))
		throw new Error('Already installed');

	const { planned, skipped } = await plan(inst, projectId);
	const projects = new Map(
		(await modrinth.getProjects([...planned.keys(), ...skipped])).map((p) => [p.id, p])
	);

	const folder = modSupport(inst.loader).folder;
	mkdirSync(join(serverDir(instanceId), folder), { recursive: true });

	const written: string[] = [];
	const rows: (typeof installedMods.$inferInsert)[] = [];
	try {
		for (const [id, { version, dependencyOf }] of planned) {
			const file = pickFile(version);
			const rel = `${folder}/${file.filename}`;
			const dest = join(serverDir(instanceId), rel);
			if (await Bun.file(dest).exists()) throw new Error(`${rel} already exists`);
			await downloadFile(dest, {
				url: file.url,
				hash: { algo: 'sha512', value: file.hashes.sha512 }
			});
			written.push(dest);
			rows.push({
				instanceId,
				kind: 'mod',
				source: 'modrinth',
				projectId: id,
				versionId: version.id,
				title: projects.get(id)?.title ?? id,
				iconUrl: projects.get(id)?.icon_url ?? null,
				versionNumber: version.version_number,
				file: rel,
				hash: file.hashes.sha512,
				dependencyOf
			});
		}
	} catch (e) {
		for (const f of written) rmSync(f, { force: true });
		throw e;
	}
	db.insert(installedMods).values(rows).run();

	return {
		installed: rows.map((r) => ({ title: r.title, version: r.versionNumber })),
		skipped: skipped.map((id) => projects.get(id)?.title ?? id)
	};
}

export function remove(instanceId: number, modId: number) {
	const row = db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.id, modId), eq(installedMods.instanceId, instanceId)))
		.get();
	if (!row) throw new Error('Not installed');
	// `file` is stored relative to the server folder and was validated when written
	rmSync(join(serverDir(instanceId), row.file), { force: true });
	db.delete(installedMods).where(eq(installedMods.id, row.id)).run();
}
