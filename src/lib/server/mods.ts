import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { installedMods } from './db/schema';
import { downloadFile } from './download';
import { getInstance, serverDir, type Instance } from './instances';
import { assertWritable } from './operations';
import * as modrinth from './modrinth';
import { modSupport } from '#lib/mod-support.js';
import { projectSides } from './mod-sides';

export type InstalledMod = typeof installedMods.$inferSelect;

/** A disabled mod keeps its file, renamed so the loader no longer sees a jar. */
export const DISABLED_SUFFIX = '.disabled';

export { modSupport };

function instanceRow(instanceId: number): Instance {
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
		.all()
		.map((row) => ({ ...row, enabled: !row.file.endsWith(DISABLED_SUFFIX) }));
}

export async function search(instanceId: number, query: string, limit: number) {
	const inst = instanceRow(instanceId);
	const res = await modrinth.searchProjects({
		query,
		loaders: modSupport(inst.loader).loaders,
		plugins: modSupport(inst.loader).noun === 'plugin',
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
async function plan(inst: Instance, projectId: string, rootVersion?: modrinth.ModrinthVersion) {
	const { loaders } = modSupport(inst.loader);
	const have = new Set(listInstalled(inst.id).map((m) => m.projectId));
	const planned = new Map<string, Planned>();
	const skipped: string[] = [];
	// the root version may be given up front (a chosen version, or an update of an installed mod)
	if (rootVersion) have.delete(projectId);
	const queue: { projectId: string | null; versionId: string | null; parent: string | null }[] = [
		{ projectId, versionId: rootVersion?.id ?? null, parent: null }
	];

	while (queue.length) {
		const next = queue.shift()!;
		let version: modrinth.ModrinthVersion | undefined;
		if (rootVersion && next.versionId === rootVersion.id) version = rootVersion;
		else if (next.versionId) version = await modrinth.getVersion(next.versionId);
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

/**
 * Downloads every planned file and records it. A failure removes whatever was already
 * written. `replacing` is the row an update supersedes: its file is swapped out only once
 * everything else succeeded.
 */
async function apply(
	inst: Instance,
	{ planned, skipped }: Awaited<ReturnType<typeof plan>>,
	replacing?: InstalledMod
) {
	const projects = new Map(
		(await modrinth.getProjects([...planned.keys(), ...skipped])).map((p) => [p.id, p])
	);
	const folder = modSupport(inst.loader).folder;
	mkdirSync(join(serverDir(inst.id), folder), { recursive: true });

	const written: string[] = [];
	const rows: (typeof installedMods.$inferInsert)[] = [];
	try {
		for (const [id, { version, dependencyOf }] of planned) {
			const file = pickFile(version);
			const rel = `${folder}/${file.filename}`;
			const dest = join(serverDir(inst.id), rel);
			if (
				rel !== replacing?.file &&
				((await Bun.file(dest).exists()) || (await Bun.file(dest + DISABLED_SUFFIX).exists()))
			)
				throw new Error(`${rel} already exists`);
			await downloadFile(dest, {
				url: file.url,
				hash: { algo: 'sha512', value: file.hashes.sha512 }
			});
			written.push(dest);
			rows.push({
				instanceId: inst.id,
				kind: 'mod',
				source: 'modrinth',
				projectId: id,
				versionId: version.id,
				title: projects.get(id)?.title ?? id,
				iconUrl: projects.get(id)?.icon_url ?? null,
				versionNumber: version.version_number,
				clientSide: projects.get(id)?.client_side ?? null,
				serverSide: projects.get(id)?.server_side ?? null,
				file: rel,
				hash: file.hashes.sha512,
				dependencyOf: replacing?.projectId === id ? replacing.dependencyOf : dependencyOf
			});
		}
	} catch (e) {
		// never delete the file an update is replacing: it is still the installed one
		const keep = replacing ? join(serverDir(inst.id), replacing.file) : null;
		for (const f of written) if (f !== keep) rmSync(f, { force: true });
		throw e;
	}

	db.transaction((tx) => {
		for (const row of rows) {
			// an update rewrites the existing row so its id stays stable for the UI
			if (replacing && row.projectId === replacing.projectId)
				tx.update(installedMods).set(row).where(eq(installedMods.id, replacing.id)).run();
			else tx.insert(installedMods).values(row).run();
		}
	});
	// the new file is in place and recorded; drop the old one unless it was overwritten
	if (replacing && !rows.some((r) => r.file === replacing.file))
		rmSync(join(serverDir(inst.id), replacing.file), { force: true });

	return {
		installed: rows.map((r) => ({ title: r.title, version: r.versionNumber })),
		skipped: skipped.map((id) => projects.get(id)?.title ?? id)
	};
}

export type ModVersion = {
	id: string;
	versionNumber: string;
	versionType: 'release' | 'beta' | 'alpha';
	publishedAt: string;
};

/** Every version of a project that runs on this instance, newest first. */
export async function listModVersions(
	instanceId: number,
	projectId: string
): Promise<ModVersion[]> {
	const inst = instanceRow(instanceId);
	const versions = await modrinth.listVersions(
		projectId,
		modSupport(inst.loader).loaders,
		inst.mcVersion
	);
	return versions.map((v) => ({
		id: v.id,
		versionNumber: v.version_number,
		versionType: v.version_type,
		publishedAt: v.date_published
	}));
}

/** Looks the version up among the compatible ones, so only installable versions can be chosen. */
async function resolveVersion(inst: Instance, projectId: string, versionId: string) {
	const versions = await modrinth.listVersions(
		projectId,
		modSupport(inst.loader).loaders,
		inst.mcVersion
	);
	const version = versions.find((v) => v.id === versionId);
	if (!version) throw new Error(`That version does not run on ${inst.loader} ${inst.mcVersion}`);
	return version;
}

export async function install(instanceId: number, projectId: string, versionId?: string) {
	const inst = instanceRow(instanceId);
	assertWritable(instanceId);
	if (listInstalled(instanceId).some((m) => m.projectId === projectId))
		throw new Error('Already installed');
	const chosen = versionId ? await resolveVersion(inst, projectId, versionId) : undefined;
	return apply(inst, await plan(inst, projectId, chosen));
}

export type ModUpdate = {
	modId: number;
	versionId: string;
	versionNumber: string;
};

/** Newer releases for the installed Modrinth mods, found by file hash in a single request. */
export async function checkUpdates(instanceId: number): Promise<ModUpdate[]> {
	const inst = instanceRow(instanceId);
	const rows = listInstalled(instanceId).filter((m) => m.source === 'modrinth' && m.hash);
	const latest = await modrinth.latestVersions(
		rows.map((r) => r.hash!),
		modSupport(inst.loader).loaders,
		inst.mcVersion
	);
	return rows.flatMap((row) => {
		const v = latest[row.hash!];
		// betas and alphas are never offered as updates
		if (!v || v.id === row.versionId || v.version_type !== 'release') return [];
		return [{ modId: row.id, versionId: v.id, versionNumber: v.version_number }];
	});
}

/** Moves an installed mod to its newest release, or to a chosen version (including older ones). */
export async function update(instanceId: number, modId: number, versionId?: string) {
	const inst = instanceRow(instanceId);
	assertWritable(instanceId);
	const row = listInstalled(instanceId).find((m) => m.id === modId);
	if (!row?.hash) throw new Error('Not installed');
	const target = versionId
		? await resolveVersion(inst, row.projectId, versionId)
		: (await modrinth.latestVersions([row.hash], modSupport(inst.loader).loaders, inst.mcVersion))[
				row.hash
			];
	if (!target || target.id === row.versionId)
		throw new Error(versionId ? 'Already on that version' : 'Already up to date');
	const result = await apply(inst, await plan(inst, row.projectId, target), row);
	// an update must not quietly switch a disabled mod back on
	if (!row.enabled) setEnabled(instanceId, row.id, false);
	return result;
}

/** Turns a mod on or off by renaming its file; the server picks the change up on its next start. */
export function setEnabled(instanceId: number, modId: number, enabled: boolean) {
	assertWritable(instanceId);
	setEnabledHeld(instanceId, modId, enabled);
}

/** The same for a job that already holds the instance, which `setEnabled` would refuse as busy. */
export function setEnabledHeld(instanceId: number, modId: number, enabled: boolean) {
	const row = db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.id, modId), eq(installedMods.instanceId, instanceId)))
		.get();
	if (!row) throw new Error('Not installed');
	if (row.file.endsWith(DISABLED_SUFFIX) === !enabled) return;
	const file = enabled ? row.file.slice(0, -DISABLED_SUFFIX.length) : row.file + DISABLED_SUFFIX;
	const root = serverDir(instanceId);
	if (!existsSync(join(root, row.file))) throw new Error(`${row.file} is missing`);
	if (existsSync(join(root, file))) throw new Error(`${file} already exists`);
	renameSync(join(root, row.file), join(root, file));
	db.update(installedMods).set({ file }).where(eq(installedMods.id, row.id)).run();
}

export function remove(instanceId: number, modId: number) {
	assertWritable(instanceId);
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

/** Fills in where mods run for rows recorded before that was kept; returns how many it filled. */
export async function backfillSides(instanceId: number) {
	const unknown = listInstalled(instanceId).filter(
		(m) => m.source === 'modrinth' && (m.clientSide === null || m.serverSide === null)
	);
	if (!unknown.length) return 0;
	const sides = await projectSides(unknown.map((m) => m.projectId));
	let filled = 0;
	for (const mod of unknown) {
		const found = sides.get(mod.projectId);
		if (!found) continue;
		db.update(installedMods).set(found).where(eq(installedMods.id, mod.id)).run();
		filled++;
	}
	return filled;
}

/** Disables every enabled mod its project says does not run on a server; returns their titles. */
export function disableClientOnly(instanceId: number) {
	const titles: string[] = [];
	for (const mod of listInstalled(instanceId)) {
		if (!mod.enabled || mod.serverSide !== 'unsupported') continue;
		setEnabled(instanceId, mod.id, false);
		titles.push(mod.title);
	}
	return titles;
}
