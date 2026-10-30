import { basename, dirname, join } from 'node:path';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { and, count, desc, eq } from 'drizzle-orm';
import { dataDir } from './config';
import { db } from './db';
import { localPackFiles, localPacks } from './db/schema';
import { isKnownVersion, latestBuild } from './loaders';
import * as modrinth from './modrinth';
import {
	LOADER_KEYS,
	overrideEntries,
	parseIndex,
	safeJoin,
	startImportLoaded,
	type IndexFile,
	type LoadedPack
} from './modpacks';
import { Zip } from './zip';
import { zipChunks, type ZipEntry } from './zip-writer';

// Modpacks made in the builder. A pack is rows in the database (its settings and the files it
// downloads, each pinned to one version and its hashes) plus a folder of config files on disk.
// It leaves the panel as a Modrinth .mrpack, and installs on a server through that same format.

export const PACK_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'] as const;
export type PackLoader = (typeof PACK_LOADERS)[number];

export type LocalPack = typeof localPacks.$inferSelect;
export type LocalPackFile = typeof localPackFiles.$inferSelect;

export const packDir = (id: number) => join(dataDir, 'packs', String(id));
export const overridesDir = (id: number) => join(packDir(id), 'overrides');

const MAX_NAME = 60;

const getRow = (id: number) => db.select().from(localPacks).where(eq(localPacks.id, id)).get();

function requirePack(id: number) {
	const pack = getRow(id);
	if (!pack) throw new Error('Pack not found');
	return pack;
}

/** Every change is a new revision, so an instance can say which one it was made from. */
function bump(id: number) {
	const pack = requirePack(id);
	db.update(localPacks)
		.set({ revision: pack.revision + 1, updatedAt: new Date() })
		.where(eq(localPacks.id, id))
		.run();
}

export function listPacks() {
	const counts = new Map(
		db
			.select({ packId: localPackFiles.packId, n: count() })
			.from(localPackFiles)
			.groupBy(localPackFiles.packId)
			.all()
			.map((r) => [r.packId, r.n])
	);
	return db
		.select()
		.from(localPacks)
		.orderBy(desc(localPacks.updatedAt), desc(localPacks.id))
		.all()
		.map((p) => ({ ...p, files: counts.get(p.id) ?? 0 }));
}

export function listFiles(packId: number) {
	return db
		.select()
		.from(localPackFiles)
		.where(eq(localPackFiles.packId, packId))
		.orderBy(localPackFiles.title)
		.all();
}

export type OverrideFile = { path: string; size: number };

/** The pack's config files, by path inside the server folder. */
export function listOverrides(packId: number): OverrideFile[] {
	const root = overridesDir(packId);
	const found: OverrideFile[] = [];
	const walk = (dir: string, prefix: string) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else found.push({ path: rel, size: statSync(join(dir, entry.name)).size });
		}
	};
	walk(root, '');
	return found.sort((a, b) => a.path.localeCompare(b.path));
}

export function getPack(id: number) {
	const pack = requirePack(id);
	return { ...pack, files: listFiles(id), overrides: listOverrides(id) };
}

const cleanName = (name: string) => {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Give the pack a name');
	if (trimmed.length > MAX_NAME) throw new Error(`The name can be at most ${MAX_NAME} characters`);
	return trimmed;
};

export async function createPack(input: {
	name: string;
	loader: PackLoader;
	mcVersion: string;
	description?: string;
}) {
	const name = cleanName(input.name);
	if (!PACK_LOADERS.includes(input.loader))
		throw new Error('Choose fabric, quilt, forge or neoforge');
	if (!(await isKnownVersion(input.loader, input.mcVersion)))
		throw new Error(`${input.loader} has no Minecraft ${input.mcVersion}`);
	const loaderVersion = (await latestBuild(input.loader, input.mcVersion)) ?? null;
	return db
		.insert(localPacks)
		.values({
			name,
			description: (input.description ?? '').trim(),
			loader: input.loader,
			loaderVersion,
			mcVersion: input.mcVersion
		})
		.returning()
		.get();
}

export function updatePack(id: number, change: { name?: string; description?: string }) {
	requirePack(id);
	const set: Partial<typeof localPacks.$inferInsert> = {};
	if (change.name !== undefined) set.name = cleanName(change.name);
	if (change.description !== undefined) set.description = change.description.trim().slice(0, 500);
	db.update(localPacks).set(set).where(eq(localPacks.id, id)).run();
	bump(id);
}

export function deletePack(id: number) {
	requirePack(id);
	db.delete(localPacks).where(eq(localPacks.id, id)).run();
	rmSync(packDir(id), { recursive: true, force: true });
}

export function duplicatePack(id: number) {
	const source = requirePack(id);
	return db.transaction((tx) => {
		const copy = tx
			.insert(localPacks)
			.values({
				name: cleanName(`${source.name} copy`.slice(0, MAX_NAME)),
				description: source.description,
				loader: source.loader,
				loaderVersion: source.loaderVersion,
				mcVersion: source.mcVersion
			})
			.returning()
			.get();
		for (const { id: _id, packId: _pack, ...file } of listFiles(id))
			tx.insert(localPackFiles)
				.values({ ...file, packId: copy.id })
				.run();
		if (existsSync(overridesDir(id)))
			cpSync(overridesDir(id), overridesDir(copy.id), { recursive: true });
		return copy;
	});
}

// ---- the mods of a pack ----

const sideOf = (value: string | null | undefined) =>
	value === 'required' || value === 'optional' || value === 'unsupported' ? value : null;

/** Prefers a stable release over betas and alphas; versions arrive newest first. */
const pickVersion = (versions: modrinth.ModrinthVersion[]) =>
	versions.find((v) => v.version_type === 'release') ?? versions[0];

function pickFile(version: modrinth.ModrinthVersion) {
	const file = version.files.find((f) => f.primary) ?? version.files[0];
	if (!file) throw new Error(`Version ${version.version_number} has no files`);
	// the name comes from a third party and is joined onto a path
	const name = basename(file.filename);
	if (name !== file.filename || name.startsWith('.') || !name.endsWith('.jar'))
		throw new Error(`Refusing unexpected file name "${file.filename}"`);
	return { ...file, filename: name };
}

const rowFor = (
	packId: number,
	version: modrinth.ModrinthVersion,
	project: modrinth.ModrinthProject | undefined,
	dependencyOf: string | null
): typeof localPackFiles.$inferInsert => {
	const file = pickFile(version);
	return {
		packId,
		projectId: version.project_id,
		versionId: version.id,
		versionNumber: version.version_number,
		title: project?.title ?? version.project_id,
		iconUrl: project?.icon_url ?? null,
		path: `mods/${file.filename}`,
		downloads: JSON.stringify([file.url]),
		sha1: file.hashes.sha1,
		sha512: file.hashes.sha512,
		size: file.size,
		clientSide: sideOf(project?.client_side),
		serverSide: sideOf(project?.server_side),
		dependencyOf
	};
};

/** Works out which versions to add: the project plus every required dependency not in the pack yet. */
async function plan(pack: LocalPack, projectId: string, root?: modrinth.ModrinthVersion) {
	const have = new Set(listFiles(pack.id).flatMap((f) => (f.projectId ? [f.projectId] : [])));
	const planned = new Map<
		string,
		{ version: modrinth.ModrinthVersion; dependencyOf: string | null }
	>();
	const skipped: string[] = [];
	const queue: { projectId: string | null; versionId: string | null; parent: string | null }[] = [
		{ projectId, versionId: root?.id ?? null, parent: null }
	];
	while (queue.length) {
		const next = queue.shift()!;
		let version: modrinth.ModrinthVersion | undefined;
		if (root && next.versionId === root.id) version = root;
		else if (next.versionId) version = await modrinth.getVersion(next.versionId);
		else if (next.projectId)
			version = pickVersion(
				await modrinth.listVersions(next.projectId, [pack.loader], pack.mcVersion)
			);
		const id = next.projectId ?? version?.project_id;
		if (!id || have.has(id) || planned.has(id)) continue;
		if (!version) {
			if (!next.parent)
				throw new Error(`No ${pack.loader} version for Minecraft ${pack.mcVersion} was found`);
			skipped.push(id);
			continue;
		}
		planned.set(id, { version, dependencyOf: next.parent });
		for (const dep of version.dependencies)
			if (dep.dependency_type === 'required')
				queue.push({ projectId: dep.project_id, versionId: dep.version_id, parent: id });
	}
	return { planned, skipped };
}

/** Adds a mod, pinned to a version (the newest release when none is given), with its required dependencies. */
export async function addMod(packId: number, projectId: string, versionId?: string) {
	const pack = requirePack(packId);
	if (listFiles(packId).some((f) => f.projectId === projectId))
		throw new Error('Already in the pack');
	let chosen: modrinth.ModrinthVersion | undefined;
	if (versionId) {
		chosen = (await modrinth.listVersions(projectId, [pack.loader], pack.mcVersion)).find(
			(v) => v.id === versionId
		);
		if (!chosen) throw new Error(`That version does not run on ${pack.loader} ${pack.mcVersion}`);
	}
	const { planned, skipped } = await plan(pack, projectId, chosen);
	const projects = new Map(
		(await modrinth.getProjects([...planned.keys(), ...skipped])).map((p) => [p.id, p])
	);
	const rows = [...planned].map(([id, { version, dependencyOf }]) =>
		rowFor(packId, version, projects.get(id), dependencyOf)
	);
	db.transaction((tx) => {
		for (const row of rows) tx.insert(localPackFiles).values(row).run();
	});
	bump(packId);
	return {
		added: rows.map((r) => ({ title: r.title, version: r.versionNumber ?? '' })),
		skipped: skipped.map((id) => projects.get(id)?.title ?? id)
	};
}

export function removeFile(packId: number, fileId: number) {
	requirePack(packId);
	const row = db
		.select()
		.from(localPackFiles)
		.where(and(eq(localPackFiles.id, fileId), eq(localPackFiles.packId, packId)))
		.get();
	if (!row) throw new Error('File not found');
	db.delete(localPackFiles).where(eq(localPackFiles.id, fileId)).run();
	bump(packId);
}

/** Every version of a project that runs in this pack, newest first. */
export async function listModVersions(packId: number, projectId: string) {
	const pack = requirePack(packId);
	const versions = await modrinth.listVersions(projectId, [pack.loader], pack.mcVersion);
	return versions.map((v) => ({
		id: v.id,
		versionNumber: v.version_number,
		versionType: v.version_type,
		publishedAt: v.date_published
	}));
}

/** Pins a mod already in the pack to another version. */
export async function setModVersion(packId: number, fileId: number, versionId: string) {
	const pack = requirePack(packId);
	const row = listFiles(packId).find((f) => f.id === fileId);
	if (!row?.projectId)
		throw new Error('That file is not from Modrinth, so it has no other versions');
	const version = (await modrinth.listVersions(row.projectId, [pack.loader], pack.mcVersion)).find(
		(v) => v.id === versionId
	);
	if (!version) throw new Error(`That version does not run on ${pack.loader} ${pack.mcVersion}`);
	const project = (await modrinth.getProjects([row.projectId]))[0];
	const { packId: _p, ...next } = rowFor(packId, version, project, row.dependencyOf);
	db.update(localPackFiles).set(next).where(eq(localPackFiles.id, fileId)).run();
	bump(packId);
}

// ---- changing the Minecraft version ----

export type VersionChange = {
	mcVersion: string;
	/** mods with a version for the new Minecraft version */
	compatible: { id: number; title: string; from: string; to: string }[];
	/** mods with none */
	incompatible: { id: number; title: string }[];
	/** files that are not from Modrinth, which cannot be checked */
	unchecked: number;
};

/** What changing the Minecraft version would do to each mod, without changing anything. */
export async function previewVersionChange(
	packId: number,
	mcVersion: string
): Promise<VersionChange> {
	const pack = requirePack(packId);
	if (!(await isKnownVersion(pack.loader, mcVersion)))
		throw new Error(`${pack.loader} has no Minecraft ${mcVersion}`);
	const result: VersionChange = { mcVersion, compatible: [], incompatible: [], unchecked: 0 };
	for (const file of listFiles(packId)) {
		if (!file.projectId) {
			result.unchecked++;
			continue;
		}
		const found = pickVersion(
			await modrinth.listVersions(file.projectId, [pack.loader], mcVersion)
		);
		if (found)
			result.compatible.push({
				id: file.id,
				title: file.title,
				from: file.versionNumber ?? '',
				to: found.version_number
			});
		else result.incompatible.push({ id: file.id, title: file.title });
	}
	return result;
}

/**
 * Moves the pack to another Minecraft version, re-pinning every mod. Mods with no version for it
 * block the change unless `dropIncompatible` says to remove them.
 */
export async function applyVersionChange(
	packId: number,
	mcVersion: string,
	dropIncompatible = false
) {
	const pack = requirePack(packId);
	const preview = await previewVersionChange(packId, mcVersion);
	if (preview.incompatible.length && !dropIncompatible)
		throw new Error(
			`${preview.incompatible.length} mods have no version for Minecraft ${mcVersion}; remove them first`
		);
	const loaderVersion = (await latestBuild(pack.loader, mcVersion)) ?? null;
	const projects = new Map(
		(
			await modrinth.getProjects(
				listFiles(packId).flatMap((f) => (f.projectId ? [f.projectId] : []))
			)
		).map((p) => [p.id, p])
	);
	const rows = new Map<number, ReturnType<typeof rowFor>>();
	for (const item of preview.compatible) {
		const file = listFiles(packId).find((f) => f.id === item.id)!;
		const version = pickVersion(
			await modrinth.listVersions(file.projectId!, [pack.loader], mcVersion)
		);
		rows.set(item.id, rowFor(packId, version!, projects.get(file.projectId!), file.dependencyOf));
	}
	db.transaction((tx) => {
		for (const [id, row] of rows) {
			const { packId: _p, ...next } = row;
			tx.update(localPackFiles).set(next).where(eq(localPackFiles.id, id)).run();
		}
		for (const item of preview.incompatible)
			tx.delete(localPackFiles).where(eq(localPackFiles.id, item.id)).run();
		tx.update(localPacks).set({ mcVersion, loaderVersion }).where(eq(localPacks.id, packId)).run();
	});
	bump(packId);
	return { updated: rows.size, removed: preview.incompatible.length };
}

// ---- config files ----

/** Stores a config file at a path inside the server folder (a path that leaves it is refused). */
export async function saveOverride(packId: number, rel: string, bytes: Uint8Array) {
	requirePack(packId);
	const dest = safeJoin(overridesDir(packId), rel);
	mkdirSync(dirname(dest), { recursive: true });
	await Bun.write(dest, bytes);
	bump(packId);
}

export function removeOverride(packId: number, rel: string) {
	requirePack(packId);
	const dest = safeJoin(overridesDir(packId), rel);
	rmSync(dest, { force: true });
	bump(packId);
}

// ---- .mrpack ----

const MAX_ENV = { required: 'required', optional: 'optional', unsupported: 'unsupported' } as const;

/** The pack as a Modrinth modpack index. */
export function buildIndex(packId: number) {
	const pack = requirePack(packId);
	const key = LOADER_KEYS.find(([, loader]) => loader === pack.loader)![0];
	const dependencies: Record<string, string> = { minecraft: pack.mcVersion };
	if (pack.loaderVersion) dependencies[key] = pack.loaderVersion;
	const files = listFiles(packId).map((f) => ({
		path: f.path,
		hashes: { ...(f.sha1 ? { sha1: f.sha1 } : {}), ...(f.sha512 ? { sha512: f.sha512 } : {}) },
		env: {
			...(f.clientSide ? { client: MAX_ENV[f.clientSide as keyof typeof MAX_ENV] } : {}),
			...(f.serverSide ? { server: MAX_ENV[f.serverSide as keyof typeof MAX_ENV] } : {})
		},
		downloads: JSON.parse(f.downloads) as string[],
		...(f.size ? { fileSize: f.size } : {})
	}));
	return {
		formatVersion: 1,
		game: 'minecraft',
		versionId: String(pack.revision),
		name: pack.name,
		summary: pack.description,
		files,
		dependencies
	};
}

/** The entries of the pack's .mrpack: the index, then every config file under overrides/. */
export async function exportEntries(
	packId: number
): Promise<{ filename: string; entries: ZipEntry[] }> {
	const pack = requirePack(packId);
	mkdirSync(packDir(packId), { recursive: true });
	const indexPath = join(packDir(packId), 'modrinth.index.json');
	await Bun.write(indexPath, JSON.stringify(buildIndex(packId), null, '\t'));
	const modified = new Date();
	const entries: ZipEntry[] = [
		{ kind: 'file', name: 'modrinth.index.json', path: indexPath, modified }
	];
	for (const file of listOverrides(packId))
		entries.push({
			kind: 'file',
			name: `overrides/${file.path}`,
			path: join(overridesDir(packId), file.path),
			modified
		});
	const safe = pack.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'modpack';
	return { filename: `${safe}-${pack.revision}.mrpack`, entries };
}

/** The whole .mrpack in memory, for installing it on a server. */
export async function exportBytes(packId: number) {
	const { entries, filename } = await exportEntries(packId);
	const parts: Uint8Array[] = [];
	for await (const chunk of zipChunks(entries)) parts.push(chunk);
	return { filename, bytes: Buffer.concat(parts) };
}

/**
 * Makes a pack from a Modrinth .mrpack. Files Modrinth knows by hash get their project and
 * version back (so they can be re-pinned); any other file is kept as it is. Config files under
 * overrides/ and server-overrides/ are stored as the pack's config files.
 */
export async function importMrpack(bytes: Uint8Array, nameOverride?: string) {
	const zip = new Zip(bytes);
	const index = parseIndex(zip);
	const found = LOADER_KEYS.find(([key]) => index.dependencies[key]);
	if (!found || found[1] === 'vanilla')
		throw new Error(
			'This pack has no mod loader; the builder makes fabric, quilt, forge or neoforge packs'
		);
	const loader = found[1] as PackLoader;

	const sha512s = index.files.flatMap((f) => (f.hashes.sha512 ? [f.hashes.sha512] : []));
	const known = await modrinth.versionsByHashes(sha512s);
	const projectIds = [...new Set(Object.values(known).map((v) => v.project_id))];
	const projects = new Map<string, modrinth.ModrinthProject>();
	for (let i = 0; i < projectIds.length; i += 100)
		for (const p of await modrinth.getProjects(projectIds.slice(i, i + 100))) projects.set(p.id, p);

	const pack = db
		.insert(localPacks)
		.values({
			name: cleanName((nameOverride ?? index.name).slice(0, MAX_NAME)),
			description: (index.summary ?? '').slice(0, 500),
			loader,
			loaderVersion: index.dependencies[found[0]] ?? null,
			mcVersion: index.dependencies.minecraft
		})
		.returning()
		.get();

	try {
		db.transaction((tx) => {
			const seen = new Set<string>();
			for (const f of index.files as IndexFile[]) {
				if (seen.has(f.path)) continue;
				seen.add(f.path);
				const version = f.hashes.sha512 ? known[f.hashes.sha512] : undefined;
				const project = version ? projects.get(version.project_id) : undefined;
				tx.insert(localPackFiles)
					.values({
						packId: pack.id,
						projectId: version?.project_id ?? null,
						versionId: version?.id ?? null,
						versionNumber: version?.version_number ?? null,
						title: project?.title ?? basename(f.path),
						iconUrl: project?.icon_url ?? null,
						path: f.path,
						downloads: JSON.stringify(f.downloads),
						sha1: f.hashes.sha1 ?? null,
						sha512: f.hashes.sha512 ?? null,
						size: f.fileSize ?? null,
						clientSide: sideOf(f.env?.client) ?? sideOf(project?.client_side),
						serverSide: sideOf(f.env?.server) ?? sideOf(project?.server_side),
						dependencyOf: null
					})
					.run();
			}
		});
		for (const [rel, entry] of overrideEntries(zip)) {
			const data = zip.read(entry);
			const dest = safeJoin(overridesDir(pack.id), rel);
			mkdirSync(dirname(dest), { recursive: true });
			await Bun.write(dest, data);
		}
	} catch (e) {
		deletePack(pack.id);
		throw e;
	}
	return pack;
}

/**
 * Creates an instance from the pack and installs it in the background, the way a Modrinth
 * modpack is: the loader's server, each file checksum-verified, then the config files. The
 * instance records which pack and revision it was made from.
 */
export async function startInstall(
	packId: number,
	opts: { name: string; port: number; ramMaxMb: number; eulaAccepted: boolean }
) {
	const pack = requirePack(packId);
	if (!listFiles(packId).length)
		throw new Error('Add at least one mod before making a server from this pack');
	const { bytes } = await exportBytes(packId);
	const zip = new Zip(bytes);
	const index = parseIndex(zip);
	const files = index.files.filter((f) => f.env?.server !== 'unsupported');
	const loaded: LoadedPack = {
		zip,
		index,
		summary: {
			projectId: '',
			versionId: String(pack.revision),
			name: pack.name,
			iconUrl: null,
			summary: pack.description,
			versionNumber: String(pack.revision),
			mcVersion: pack.mcVersion,
			loader: pack.loader,
			loaderVersion: pack.loaderVersion,
			files: files.length,
			clientOnly: index.files.length - files.length,
			downloadBytes: files.reduce((sum, f) => sum + (f.fileSize ?? 0), 0),
			overrides: overrideEntries(zip).size
		}
	};
	return startImportLoaded(loaded, opts, {
		packName: pack.name,
		fromPackId: pack.id,
		fromPackRevision: pack.revision
	});
}
