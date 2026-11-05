import { and, count, desc, eq } from 'drizzle-orm';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { CONFIG_SIDES, inSide, isSide } from '#lib/config-sides.js';
import { assertEditableSize, decodeText } from '#lib/editable.js';
import { isResourcePack, RESOURCE_PACKS } from '#lib/modpacks/pack-files.js';
import { PACK_LOADERS, type PackLoader } from '#lib/pack-loaders.js';
import { cleanPath, under } from '#lib/paths.js';
import { applyChanges, sha1, type Changes } from '#lib/server/change-set.js';
import { dataDir } from '#lib/server/config.js';
import { db } from '#lib/server/db/index.js';
import { localPackFiles, localPacks } from '#lib/server/db/schema.js';
import { isHostCode } from '#lib/server/host-code.js';
import { isKnownVersion, latestBuild, loaderBuilds } from '#lib/server/loaders.js';
import { pickFile, pickVersion, resolveMods } from '#lib/server/mod-resolver.js';
import * as modrinth from '#lib/server/modrinth.js';
import { useAsServerPackHeld } from '#lib/server/packs.js';
import { zipChunks, type ZipEntry } from '#lib/server/zip-writer.js';

import { startImportLoaded, summarize, type LoadedPack } from './modpacks';
import { readMrpack, safeJoin, writeIndex, type IndexFile } from './mrpack';

// Modpacks made in the builder. A pack is rows in the database (its settings and the files it
// downloads, each pinned to one version and its hashes) plus a folder of config files on disk.
// It leaves the panel as a Modrinth .mrpack, and installs on a server through that same format.

export { isResourcePack, type PackLoader };

export type LocalPack = typeof localPacks.$inferSelect;

export const packDir = (id: number) => join(dataDir, 'packs', String(id));
export const overridesDir = (id: number) => join(packDir(id), 'overrides');

/** The absolute path of a config file or folder, by its path with its folder (`overrides/config/a.toml`). */
function configPath(packId: number, rel: string) {
	if (!inSide(rel)) throw new Error(`${rel || 'That'} is not inside ${CONFIG_SIDES.join(', ')}`);
	return safeJoin(packDir(packId), rel);
}

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

/** The pack's config files, by path with their folder (`server-overrides/config/a.toml`). */
export function listOverrides(packId: number): OverrideFile[] {
	const found: OverrideFile[] = [];
	const walk = (dir: string, prefix: string) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else found.push({ path: rel, size: statSync(join(dir, entry.name)).size });
		}
	};
	for (const side of CONFIG_SIDES) walk(join(packDir(packId), side), side);
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
				mcVersion: source.mcVersion,
				serverPackProjectId: source.serverPackProjectId,
				serverPackVersionId: source.serverPackVersionId,
				serverPackVersionNumber: source.serverPackVersionNumber,
				serverPackTitle: source.serverPackTitle,
				serverPackIconUrl: source.serverPackIconUrl
			})
			.returning()
			.get();
		for (const { id: _id, packId: _pack, ...file } of listFiles(id))
			tx.insert(localPackFiles)
				.values({ ...file, packId: copy.id })
				.run();
		for (const side of CONFIG_SIDES)
			if (existsSync(join(packDir(id), side)))
				cpSync(join(packDir(id), side), join(packDir(copy.id), side), { recursive: true });
		const icon = iconFile(id);
		if (icon) {
			mkdirSync(packDir(copy.id), { recursive: true });
			cpSync(icon.path, join(packDir(copy.id), basename(icon.path)));
		}
		return copy;
	});
}

/** Searches Modrinth for mods that run in this pack. */
export async function searchMods(packId: number, query: string, limit: number) {
	const pack = requirePack(packId);
	const res = await modrinth.searchProjects({
		query,
		loaders: [pack.loader],
		plugins: false,
		mc: pack.mcVersion,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

const sideOf = (value: string | null | undefined) =>
	value === 'required' || value === 'optional' || value === 'unsupported' ? value : null;

/** The Modrinth loaders to match for a file: resource packs have none of their own. */
const loadersFor = (pack: LocalPack, file: { path: string }) =>
	isResourcePack(file) ? [] : [pack.loader];

const rowFor = (
	packId: number,
	version: modrinth.ModrinthVersion,
	project: modrinth.ModrinthProject | undefined,
	dependencyOf: string | null,
	folder: 'mods' | typeof RESOURCE_PACKS = 'mods'
): typeof localPackFiles.$inferInsert => {
	const resourcePack = folder === RESOURCE_PACKS;
	const file = pickFile(version, resourcePack ? '.zip' : '.jar');
	return {
		packId,
		projectId: version.project_id,
		versionId: version.id,
		versionNumber: version.version_number,
		title: project?.title ?? version.project_id,
		iconUrl: project?.icon_url ?? null,
		path: `${folder}/${file.filename}`,
		downloads: JSON.stringify([file.url]),
		sha1: file.hashes.sha1,
		sha512: file.hashes.sha512,
		size: file.size,
		// a client resource pack is for players' launchers; a server never loads it
		clientSide: resourcePack ? 'required' : sideOf(project?.client_side),
		serverSide: resourcePack ? 'unsupported' : sideOf(project?.server_side),
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

/** Searches Modrinth for resource packs for this pack's Minecraft version. */
export async function searchResourcePacks(packId: number, query: string, limit: number) {
	const pack = requirePack(packId);
	const res = await modrinth.searchProjects({
		query,
		type: 'resourcepack',
		loaders: [],
		mc: pack.mcVersion,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

/** A resource pack's versions for this pack's Minecraft version, newest first. */
async function resourcePackVersions(pack: LocalPack, projectId: string) {
	return modrinth.listVersions(projectId, [], pack.mcVersion);
}

/** The chosen version of a resource pack, else its newest release, else its newest. */
async function chooseResourcePack(pack: LocalPack, projectId: string, versionId?: string) {
	const versions = await resourcePackVersions(pack, projectId);
	const version = versionId ? versions.find((v) => v.id === versionId) : pickVersion(versions);
	if (!version)
		throw new Error(
			versionId
				? `That version is not for Minecraft ${pack.mcVersion}`
				: `No version for Minecraft ${pack.mcVersion} was found`
		);
	return version;
}

/** Adds a client resource pack to the .mrpack's resourcepacks/, pinned to a version. */
export async function addResourcePack(packId: number, projectId: string, versionId?: string) {
	const pack = requirePack(packId);
	if (listFiles(packId).some((f) => f.projectId === projectId))
		throw new Error('Already in the pack');
	const version = await chooseResourcePack(pack, projectId, versionId);
	const [project] = await modrinth.getProjects([projectId]);
	const row = rowFor(packId, version, project, null, RESOURCE_PACKS);
	db.insert(localPackFiles).values(row).run();
	bump(packId);
	return { title: row.title, version: row.versionNumber ?? '' };
}

/** A resource pack's versions that fit this pack, newest first; for the versions sheet. */
export async function listResourcePackVersions(packId: number, projectId: string) {
	return (await resourcePackVersions(requirePack(packId), projectId)).map((v) => ({
		id: v.id,
		versionNumber: v.version_number,
		versionType: v.version_type,
		publishedAt: v.date_published
	}));
}

/** Sets the server resource pack that servers made from this pack start with. */
export async function setServerPack(packId: number, projectId: string, versionId?: string) {
	const pack = requirePack(packId);
	const version = await chooseResourcePack(pack, projectId, versionId);
	const [project] = await modrinth.getProjects([projectId]);
	db.update(localPacks)
		.set({
			serverPackProjectId: projectId,
			serverPackVersionId: version.id,
			serverPackVersionNumber: version.version_number,
			serverPackTitle: project?.title ?? projectId,
			serverPackIconUrl: project?.icon_url ?? null
		})
		.where(eq(localPacks.id, packId))
		.run();
	bump(packId);
	return { title: project?.title ?? projectId, version: version.version_number };
}

const NO_SERVER_PACK = {
	serverPackProjectId: null,
	serverPackVersionId: null,
	serverPackVersionNumber: null,
	serverPackTitle: null,
	serverPackIconUrl: null
};

export function clearServerPack(packId: number) {
	requirePack(packId);
	db.update(localPacks).set(NO_SERVER_PACK).where(eq(localPacks.id, packId)).run();
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
	const version = (
		await modrinth.listVersions(row.projectId, loadersFor(pack, row), pack.mcVersion)
	).find((v) => v.id === versionId);
	if (!version) throw new Error(`That version does not run on ${pack.loader} ${pack.mcVersion}`);
	const project = (await modrinth.getProjects([row.projectId]))[0];
	const { packId: _p, ...next } = rowFor(
		packId,
		version,
		project,
		row.dependencyOf,
		isResourcePack(row) ? RESOURCE_PACKS : 'mods'
	);
	db.update(localPackFiles).set(next).where(eq(localPackFiles.id, fileId)).run();
	bump(packId);
}

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
			await modrinth.listVersions(file.projectId, loadersFor(pack, file), mcVersion)
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
	// the server pack follows the Minecraft version too, and is dropped when it has none for it
	const serverPackVersion = pack.serverPackProjectId
		? pickVersion(await modrinth.listVersions(pack.serverPackProjectId, [], mcVersion))
		: undefined;
	const serverPack = !pack.serverPackProjectId
		? {}
		: serverPackVersion
			? {
					serverPackVersionId: serverPackVersion.id,
					serverPackVersionNumber: serverPackVersion.version_number
				}
			: NO_SERVER_PACK;
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
			rowFor(
				packId,
				chosen.get(item.id)!,
				projects.get(file.projectId!),
				file.dependencyOf,
				isResourcePack(file) ? RESOURCE_PACKS : 'mods'
			)
		);
	}
	db.transaction((tx) => {
		for (const [id, row] of rows) {
			const { packId: _p, ...next } = row;
			tx.update(localPackFiles).set(next).where(eq(localPackFiles.id, id)).run();
		}
		for (const item of preview.incompatible)
			tx.delete(localPackFiles).where(eq(localPackFiles.id, item.id)).run();
		tx.update(localPacks)
			.set({ mcVersion, loaderVersion, ...serverPack })
			.where(eq(localPacks.id, packId))
			.run();
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

/**
 * Stores config files, by path with their folder, as one new revision. Every path is checked before
 * the first is written, so a path outside the three folders refuses the lot.
 */
export async function saveOverrides(packId: number, files: { rel: string; bytes: Uint8Array }[]) {
	requirePack(packId);
	const dests = files.map(({ rel }) => configPath(packId, rel));
	for (const [index, { bytes }] of files.entries()) {
		mkdirSync(dirname(dests[index]), { recursive: true });
		await Bun.write(dests[index], bytes);
	}
	if (files.length) bump(packId);
}

export const saveOverride = (packId: number, rel: string, bytes: Uint8Array) =>
	saveOverrides(packId, [{ rel, bytes }]);

function overrideFile(packId: number, rel: string) {
	requirePack(packId);
	const dest = configPath(packId, rel);
	const stat = existsSync(dest) ? statSync(dest) : undefined;
	if (stat && !stat.isFile()) throw new Error('Not a file');
	return { dest, stat };
}

/** A config file as text. `hash` is what `writeOverrideText` takes back, to spot a change made meanwhile. */
export function readOverrideText(packId: number, rel: string) {
	const { dest, stat } = overrideFile(packId, rel);
	if (!stat) throw new Error('Config file not found');
	assertEditableSize(stat.size);
	const bytes = readFileSync(dest);
	return { content: decodeText(bytes), size: stat.size, hash: sha1(bytes) };
}

/** Slashes tidied, repeats dropped, and an item inside another chosen folder left to that folder. */
function topLevel(paths: string[]) {
	const clean = [...new Set(paths.map(cleanPath).filter(Boolean))];
	return clean.filter((p) => !clean.some((q) => q !== p && under(p, q)));
}

export type OverrideChanges = Changes;

/** Refuses a change outside the three config folders, or to one of them itself. */
function assertConfigPath(path: string, how: string) {
	if (isSide(path)) throw new Error(`${path} is always there and cannot be ${how}`);
	if (!inSide(path)) throw new Error(`Config files go in ${CONFIG_SIDES.join(', ')}`);
}

/**
 * Applies a set of changes to the config files together, as one revision, all or none (see
 * `applyChanges`; a pack's moves name each file). Paths carry their folder, and nothing may land
 * outside the three folders or move or delete one of them. `check` is asked about every path a
 * file is put at or moved from. Folders left empty are removed, since a pack cannot keep one.
 * Returns how many files changed, and the hash of each written text as it is now.
 */
export async function applyOverrideChanges(
	packId: number,
	changes: OverrideChanges,
	check?: (path: string) => void
) {
	requirePack(packId);
	const root = packDir(packId);
	mkdirSync(root, { recursive: true });
	const result = await applyChanges(
		{
			root,
			mayTake: (path, how) => {
				assertConfigPath(path, how);
				// deleting takes nothing in, so only a move away is asked about
				if (how === 'moved') check?.(path);
			},
			mayPlace: (path, files) => {
				assertConfigPath(path, 'replaced');
				files.forEach((file) => check?.(file));
			},
			mayEdit: (path) => {
				assertConfigPath(path, 'edited');
				check?.(path);
			},
			pruneEmpty: true
		},
		changes
	);
	if (result.changed) bump(packId);
	return result;
}

/** The entries of a zip of the chosen files and folders, folders kept as they are in the pack. */
export function exportOverridesZip(packId: number, paths: string[]) {
	const pack = requirePack(packId);
	const chosen = topLevel(paths);
	if (!chosen.length) throw new Error('Choose a file or folder');
	const all = listOverrides(packId);
	const modified = new Date();
	const entries: ZipEntry[] = [];
	for (const rel of chosen) {
		if (!isSide(rel)) configPath(packId, rel);
		const found = all.filter((f) => under(f.path, rel));
		if (!found.length) throw new Error(`There is nothing to download in ${rel}`);
		for (const file of found)
			entries.push({
				kind: 'file',
				name: file.path,
				path: join(packDir(packId), file.path),
				modified
			});
	}
	const safe = pack.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'modpack';
	return { filename: `${safe}-configs.zip`, entries };
}

const MAX_ENV = { required: 'required', optional: 'optional', unsupported: 'unsupported' } as const;

/** The pack as a Modrinth modpack index. */
export function buildIndex(packId: number) {
	const pack = requirePack(packId);
	const files = listFiles(packId).map((f): IndexFile => ({
		path: f.path,
		hashes: { ...(f.sha1 ? { sha1: f.sha1 } : {}), ...(f.sha512 ? { sha512: f.sha512 } : {}) },
		env: {
			...(f.clientSide ? { client: MAX_ENV[f.clientSide as keyof typeof MAX_ENV] } : {}),
			...(f.serverSide ? { server: MAX_ENV[f.serverSide as keyof typeof MAX_ENV] } : {})
		},
		downloads: JSON.parse(f.downloads) as string[],
		...(f.size ? { fileSize: f.size } : {})
	}));
	return writeIndex(
		{
			name: pack.name,
			summary: pack.description,
			versionNumber: String(pack.revision),
			mcVersion: pack.mcVersion,
			loader: pack.loader,
			loaderVersion: pack.loaderVersion
		},
		files
	);
}

/** The entries of the pack's .mrpack: the index, then every config file in its folder. */
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
			name: file.path,
			path: join(packDir(packId), file.path),
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
 * version back (so they can be re-pinned); any other file is kept as it is. Config files are kept
 * in the folder they came in: overrides/, server-overrides/ or client-overrides/. With `vettedOnly` (an
 * import by anyone but the owner), a pack with a file Modrinth does not know, or with code in its
 * config files, is refused: either could run anything on the host once installed.
 */
export async function importMrpack(
	bytes: Uint8Array,
	nameOverride?: string,
	{ vettedOnly = false } = {}
) {
	const mrpack = readMrpack(bytes);
	if (mrpack.loader === 'vanilla')
		throw new Error(
			'This pack has no mod loader; the builder makes fabric, quilt, forge or neoforge packs'
		);
	const loader = mrpack.loader as PackLoader;
	const configs = mrpack.configs(CONFIG_SIDES);

	const sha512s = mrpack.files.flatMap((f) => (f.hashes.sha512 ? [f.hashes.sha512] : []));
	const known = await modrinth.versionsByHashes(sha512s);
	if (vettedOnly) {
		const unknown = mrpack.files.find((f) => !f.hashes.sha512 || !known[f.hashes.sha512]);
		if (unknown)
			throw new Error(
				`Only the owner may import a pack with files Modrinth does not know, such as ${unknown.path}`
			);
		const code = [...configs.keys()].find(isHostCode);
		if (code)
			throw new Error(
				`Only the owner may import a pack with code in its config files, such as ${code}`
			);
	}
	const projects = new Map(
		(await modrinth.getProjects(Object.values(known).map((v) => v.project_id))).map((p) => [
			p.id,
			p
		])
	);

	const pack = db
		.insert(localPacks)
		.values({
			name: cleanName((nameOverride ?? mrpack.name).slice(0, MAX_NAME)),
			description: mrpack.summary.slice(0, 500),
			loader,
			loaderVersion: mrpack.loaderVersion,
			mcVersion: mrpack.mcVersion
		})
		.returning()
		.get();

	try {
		db.transaction((tx) => {
			const seen = new Set<string>();
			for (const f of mrpack.files) {
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
		for (const [rel, entry] of configs) {
			const data = mrpack.read(entry);
			const dest = configPath(pack.id, rel);
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
	const mrpack = readMrpack((await exportBytes(packId)).bytes);
	return {
		mrpack,
		summary: summarize(mrpack, {
			projectId: localPackSource(pack.id),
			versionId: localRevisionId(pack.revision),
			versionNumber: `revision ${pack.revision}`,
			name: pack.name,
			iconUrl: iconUrlOf(pack.id)
		})
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
	const serverPack = pack.serverPackProjectId
		? { projectId: pack.serverPackProjectId, versionId: pack.serverPackVersionId ?? undefined }
		: null;
	return startImportLoaded(
		loaded,
		opts,
		{
			packName: pack.name,
			packIconUrl: iconUrlOf(pack.id),
			fromPackId: pack.id,
			fromPackRevision: pack.revision
		},
		serverPack
			? async (instanceId, progress) => {
					progress('Setting the server resource pack');
					// the server works without it, so a pack Modrinth no longer serves does not fail the install
					await useAsServerPackHeld(instanceId, serverPack.projectId, serverPack.versionId).catch(
						() => undefined
					);
				}
			: undefined
	);
}
