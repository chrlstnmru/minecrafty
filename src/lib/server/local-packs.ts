import { and, count, desc, eq } from 'drizzle-orm';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { PACK_LOADERS, type PackLoader } from '#lib/pack-loaders.js';

import { dataDir } from './config';
import { db } from './db';
import { localPackFiles, localPacks } from './db/schema';
import { isHostCode } from './host-code';
import { isKnownVersion, latestBuild, loaderBuilds } from './loaders';
import { pickFile, pickVersion, resolveMods } from './mod-resolver';
import {
	LOADER_KEYS,
	overrideEntries,
	parseIndex,
	safeJoin,
	startImportLoaded,
	type IndexFile,
	type LoadedPack
} from './modpacks';
import * as modrinth from './modrinth';
import { Zip } from './zip';
import { zipChunks, type ZipEntry } from './zip-writer';

// Modpacks made in the builder. A pack is rows in the database (its settings and the files it
// downloads, each pinned to one version and its hashes) plus a folder of config files on disk.
// It leaves the panel as a Modrinth .mrpack, and installs on a server through that same format.

export { PACK_LOADERS, type PackLoader };

export type LocalPack = typeof localPacks.$inferSelect;
export type LocalPackFile = typeof localPackFiles.$inferSelect;

export const packDir = (id: number) => join(dataDir, 'packs', String(id));
export const overridesDir = (id: number) => join(packDir(id), 'overrides');

const MAX_NAME = 60;
const MAX_ICON_BYTES = 2 * 1024 * 1024;

const ICON_TYPES = {
	png: 'image/png',
	jpg: 'image/jpeg',
	webp: 'image/webp'
} as const;
type IconExt = keyof typeof ICON_TYPES;

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

// ---- the pack's icon ----

/** The image's kind from its first bytes, not from a name or type the uploader chose. */
function sniffIcon(bytes: Uint8Array): IconExt | null {
	const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
	if (starts(0xff, 0xd8, 0xff)) return 'jpg';
	if (
		starts(0x52, 0x49, 0x46, 0x46) &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	)
		return 'webp';
	return null;
}

/** The icon file on disk, if the pack has one. */
export function iconFile(packId: number) {
	for (const ext of Object.keys(ICON_TYPES) as IconExt[]) {
		const path = join(packDir(packId), `icon.${ext}`);
		if (existsSync(path)) return { path, type: ICON_TYPES[ext], mtime: statSync(path).mtimeMs };
	}
	return null;
}

/** Where the browser loads the icon from; it changes when the icon does, so a new one shows at once. */
function iconUrlOf(packId: number) {
	const icon = iconFile(packId);
	return icon ? `/modpacks/${packId}/icon?v=${Math.round(icon.mtime)}` : null;
}

/** Stores a PNG, JPEG or WebP as the pack's icon (at most 2 MB), replacing the old one. */
export async function saveIcon(packId: number, bytes: Uint8Array) {
	requirePack(packId);
	if (bytes.length > MAX_ICON_BYTES) throw new Error('The image is too large (limit 2 MB)');
	const ext = sniffIcon(bytes);
	if (!ext) throw new Error('Use a PNG, JPEG or WebP image');
	mkdirSync(packDir(packId), { recursive: true });
	removeIconFiles(packId);
	await Bun.write(join(packDir(packId), `icon.${ext}`), bytes);
	bump(packId);
}

function removeIconFiles(packId: number) {
	for (const ext of Object.keys(ICON_TYPES))
		rmSync(join(packDir(packId), `icon.${ext}`), { force: true });
}

export function removeIcon(packId: number) {
	requirePack(packId);
	removeIconFiles(packId);
	bump(packId);
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
		.map((p) => ({ ...p, files: counts.get(p.id) ?? 0, iconUrl: iconUrlOf(p.id) }));
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
	return { ...pack, files: listFiles(id), overrides: listOverrides(id), iconUrl: iconUrlOf(id) };
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
		const icon = iconFile(id);
		if (icon) {
			mkdirSync(packDir(copy.id), { recursive: true });
			cpSync(icon.path, join(packDir(copy.id), basename(icon.path)));
		}
		return copy;
	});
}

// ---- the mods of a pack ----

/** Searches Modrinth for mods that run in this pack. */
export async function searchMods(packId: number, query: string, limit: number) {
	const pack = requirePack(packId);
	const res = await modrinth.searchProjects({
		query,
		loaders: [pack.loader],
		plugins: false,
		mc: pack.mcVersion,
		// a pack is for players too: client-only mods such as Sodium go in the .mrpack, and a server
		// made from it skips them
		serverSide: false,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

const sideOf = (value: string | null | undefined) =>
	value === 'required' || value === 'optional' || value === 'unsupported' ? value : null;

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

/** Which versions to add: the project plus every required dependency not in the pack yet. */
function plan(pack: LocalPack, projectId: string, root?: modrinth.ModrinthVersion) {
	return resolveMods(
		{ loader: pack.loader, loaders: [pack.loader], mcVersion: pack.mcVersion },
		new Set(listFiles(pack.id).flatMap((f) => (f.projectId ? [f.projectId] : []))),
		projectId,
		{ root }
	);
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

/**
 * Looks up, once per mod, the version each would move to. `chosen` holds those versions by file
 * id so applying the change does not ask Modrinth again.
 */
async function planVersionChange(pack: LocalPack, mcVersion: string) {
	if (!(await isKnownVersion(pack.loader, mcVersion)))
		throw new Error(`${pack.loader} has no Minecraft ${mcVersion}`);
	const preview: VersionChange = { mcVersion, compatible: [], incompatible: [], unchecked: 0 };
	const files = listFiles(pack.id);
	const chosen = new Map<number, modrinth.ModrinthVersion>();
	for (const file of files) {
		if (!file.projectId) {
			preview.unchecked++;
			continue;
		}
		const found = pickVersion(
			await modrinth.listVersions(file.projectId, [pack.loader], mcVersion)
		);
		if (found) {
			chosen.set(file.id, found);
			preview.compatible.push({
				id: file.id,
				title: file.title,
				from: file.versionNumber ?? '',
				to: found.version_number
			});
		} else preview.incompatible.push({ id: file.id, title: file.title });
	}
	return { preview, files, chosen };
}

/** What changing the Minecraft version would do to each mod, without changing anything. */
export async function previewVersionChange(
	packId: number,
	mcVersion: string
): Promise<VersionChange> {
	return (await planVersionChange(requirePack(packId), mcVersion)).preview;
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
	const { preview, files, chosen } = await planVersionChange(pack, mcVersion);
	if (preview.incompatible.length && !dropIncompatible)
		throw new Error(
			`${preview.incompatible.length} mods have no version for Minecraft ${mcVersion}; remove them first`
		);
	const loaderVersion = (await latestBuild(pack.loader, mcVersion)) ?? null;
	const projects = new Map(
		(await modrinth.getProjects(files.flatMap((f) => (f.projectId ? [f.projectId] : [])))).map(
			(p) => [p.id, p]
		)
	);
	const byId = new Map(files.map((f) => [f.id, f]));
	const rows = new Map<number, ReturnType<typeof rowFor>>();
	for (const item of preview.compatible) {
		const file = byId.get(item.id)!;
		rows.set(
			item.id,
			rowFor(packId, chosen.get(item.id)!, projects.get(file.projectId!), file.dependencyOf)
		);
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

/** The loader builds a pack may use on its Minecraft version, newest first. */
export async function packLoaderBuilds(packId: number) {
	const pack = requirePack(packId);
	return loaderBuilds(pack.loader, pack.mcVersion);
}

/** Pins the pack to one loader build; a change of Minecraft version moves it to that version's newest. */
export async function setLoaderVersion(packId: number, loaderVersion: string) {
	const pack = requirePack(packId);
	if (!(await loaderBuilds(pack.loader, pack.mcVersion)).includes(loaderVersion))
		throw new Error(`${pack.loader} has no build ${loaderVersion} for Minecraft ${pack.mcVersion}`);
	if (loaderVersion === pack.loaderVersion) return;
	db.update(localPacks).set({ loaderVersion }).where(eq(localPacks.id, packId)).run();
	bump(packId);
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
 * overrides/ and server-overrides/ are stored as the pack's config files. With `vettedOnly` (an
 * import by anyone but the owner), a pack with a file Modrinth does not know, or with code in its
 * config files, is refused: either could run anything on the host once installed.
 */
export async function importMrpack(
	bytes: Uint8Array,
	nameOverride?: string,
	{ vettedOnly = false } = {}
) {
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
	if (vettedOnly) {
		const unknown = index.files.find((f) => !f.hashes.sha512 || !known[f.hashes.sha512]);
		if (unknown)
			throw new Error(
				`Only the owner may import a pack with files Modrinth does not know, such as ${unknown.path}`
			);
		const code = [...overrideEntries(zip).keys()].find(isHostCode);
		if (code)
			throw new Error(
				`Only the owner may import a pack with code in its config files, such as ${code}`
			);
	}
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

/** How a server made from a builder pack names its source and revision, in the modpack updater's terms. */
export const localPackSource = (packId: number) => `local:${packId}`;
export const localRevisionId = (revision: number) => `rev:${revision}`;

/** The pack at its current revision, read the way a downloaded .mrpack is. */
export async function loadLocalPack(packId: number): Promise<LoadedPack> {
	const pack = requirePack(packId);
	const { bytes } = await exportBytes(packId);
	const zip = new Zip(bytes);
	const index = parseIndex(zip);
	const files = index.files.filter((f) => f.env?.server !== 'unsupported');
	return {
		zip,
		index,
		summary: {
			projectId: localPackSource(pack.id),
			versionId: localRevisionId(pack.revision),
			name: pack.name,
			iconUrl: iconUrlOf(pack.id),
			summary: pack.description,
			versionNumber: `revision ${pack.revision}`,
			mcVersion: pack.mcVersion,
			loader: pack.loader,
			loaderVersion: pack.loaderVersion,
			files: files.length,
			clientOnly: index.files.length - files.length,
			downloadBytes: files.reduce((sum, f) => sum + (f.fileSize ?? 0), 0),
			overrides: overrideEntries(zip).size
		}
	};
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
	const loaded = await loadLocalPack(packId);
	return startImportLoaded(loaded, opts, {
		packName: pack.name,
		packIconUrl: iconUrlOf(pack.id),
		fromPackId: pack.id,
		fromPackRevision: pack.revision
	});
}
