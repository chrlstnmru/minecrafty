import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { dataDir } from './config';
import { db } from './db';
import { installedMods, instances } from './db/schema';
import { downloadFile } from './download';
import { clearProgress, setProgress } from './install-progress';
import { installBase, insertInstance, serverDir } from './instances';
import type { Loader } from './loaders';
import * as modrinth from './modrinth';
import { safeEntryName } from '#lib/safe-entry-name.js';
import { Zip, type ZipEntry } from './zip';
import { writeManifest } from './modpack-manifest';

// Modrinth modpacks (.mrpack): a zip with modrinth.index.json (what to download), plus
// overrides/ and server-overrides/ folders that are copied into the server as they are.

const MAX_PACK_BYTES = 600 * 1024 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;

// the hosts the .mrpack format allows downloads from
const ALLOWED_HOSTS = new Set([
	'cdn.modrinth.com',
	'github.com',
	'raw.githubusercontent.com',
	'gitlab.com'
]);

export type IndexFile = {
	path: string;
	hashes: { sha1?: string; sha512?: string };
	env?: { client?: string; server?: string };
	downloads: string[];
	fileSize?: number;
};

type PackIndex = {
	formatVersion: number;
	game: string;
	name: string;
	versionId: string;
	summary?: string;
	files: IndexFile[];
	dependencies: Record<string, string>;
};

export type ModpackSummary = {
	projectId: string;
	versionId: string;
	name: string;
	/** the pack's icon on Modrinth */
	iconUrl: string | null;
	summary: string;
	versionNumber: string;
	mcVersion: string;
	loader: Loader;
	loaderVersion: string | null;
	/** files that will be downloaded for the server */
	files: number;
	clientOnly: number;
	downloadBytes: number;
	/** files copied straight from the pack (configs, scripts, ...) */
	overrides: number;
};

export type LoadedPack = { summary: ModpackSummary; index: PackIndex; zip: Zip };

const LOADER_KEYS: [string, Loader][] = [
	['fabric-loader', 'fabric'],
	['quilt-loader', 'quilt'],
	['neoforge', 'neoforge'],
	['forge', 'forge']
];

/** Joins an untrusted relative path onto `base`, refusing anything that would leave it. */
export function safeJoin(base: string, rel: string) {
	const clean = rel.replaceAll('\\', '/');
	if (
		!clean ||
		clean.startsWith('/') ||
		/^[a-zA-Z]:/.test(clean) ||
		clean.split('/').includes('..')
	)
		throw new Error(`Refusing unsafe path "${rel}"`);
	const full = resolve(base, clean);
	if (!full.startsWith(resolve(base) + sep)) throw new Error(`Refusing unsafe path "${rel}"`);
	return full;
}

const cacheDir = join(dataDir, 'tmp', 'modpacks');

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Drops cached packs nobody asked for in a day, so the cache cannot grow without bound. */
function pruneCache() {
	try {
		for (const name of readdirSync(cacheDir)) {
			const path = join(cacheDir, name);
			if (Date.now() - statSync(path).mtimeMs > CACHE_MAX_AGE_MS) rmSync(path, { force: true });
		}
	} catch {
		// no cache yet
	}
}

/** Downloads the version's .mrpack (kept in a cache so previewing then importing downloads it once). */
async function fetchPack(versionId: string) {
	const version = await modrinth.getVersion(versionId);
	const file = version.files.find((f) => f.filename.endsWith('.mrpack'));
	if (!file) throw new Error('This version is not a modpack');
	if (file.size > MAX_PACK_BYTES)
		throw new Error(`The modpack is too large (limit ${MAX_PACK_BYTES / 1024 / 1024} MB)`);

	pruneCache();
	mkdirSync(cacheDir, { recursive: true });
	const path = join(cacheDir, `${file.hashes.sha512}.mrpack`);
	if (!(await Bun.file(path).exists()))
		await downloadFile(path, {
			url: file.url,
			hash: { algo: 'sha512', value: file.hashes.sha512 }
		});
	return { version, path };
}

function parseIndex(zip: Zip): PackIndex {
	const entry = zip.find('modrinth.index.json');
	if (!entry) throw new Error('This is not a Modrinth modpack (modrinth.index.json is missing)');
	if (entry.size > MAX_INDEX_BYTES) throw new Error('The modpack index is too large');
	const index = JSON.parse(new TextDecoder().decode(zip.read(entry))) as PackIndex;
	if (index.formatVersion !== 1 || index.game !== 'minecraft')
		throw new Error('Unsupported modpack format');
	if (!index.dependencies?.minecraft || !Array.isArray(index.files))
		throw new Error('The modpack index is incomplete');
	return index;
}

export const wantsOnServer = (f: IndexFile) => f.env?.server !== 'unsupported';

/**
 * The pack's name and icon on Modrinth. The index's own `name` is whatever the author typed into
 * their build tool, and for some packs it is just the version number.
 */
export async function projectInfo(projectId: string, fallbackName: string) {
	try {
		const project = (await modrinth.getProjects([projectId]))[0];
		return { name: project?.title || fallbackName, iconUrl: project?.icon_url ?? null };
	} catch {
		return { name: fallbackName, iconUrl: null };
	}
}

export async function loadModpack(versionId: string): Promise<LoadedPack> {
	const { version, path } = await fetchPack(versionId);
	const zip = new Zip(new Uint8Array(await Bun.file(path).arrayBuffer()));
	const index = parseIndex(zip);

	const info = await projectInfo(version.project_id, index.name);
	const found = LOADER_KEYS.find(([key]) => index.dependencies[key]);
	const files = index.files.filter(wantsOnServer);
	return {
		index,
		zip,
		summary: {
			projectId: version.project_id,
			versionId: version.id,
			name: info.name,
			iconUrl: info.iconUrl,
			summary: index.summary ?? '',
			versionNumber: index.versionId,
			mcVersion: index.dependencies.minecraft,
			loader: found?.[1] ?? 'vanilla',
			loaderVersion: found ? index.dependencies[found[0]] : null,
			files: files.length,
			clientOnly: index.files.length - files.length,
			downloadBytes: files.reduce((sum, f) => sum + (f.fileSize ?? 0), 0),
			overrides: zip.entries.filter(
				(e) =>
					!e.isDir && (e.name.startsWith('overrides/') || e.name.startsWith('server-overrides/'))
			).length
		}
	};
}

export type ImportOptions = {
	versionId: string;
	name: string;
	port: number;
	ramMaxMb: number;
	eulaAccepted: boolean;
};

/**
 * Creates the instance right away in an "installing" state and finishes the import in the
 * background (a pack can mean hundreds of downloads). Progress shows in the instance list.
 */
export async function startImport(opts: ImportOptions) {
	if (!opts.eulaAccepted) throw new Error('You must accept the Minecraft EULA');
	const pack = await loadModpack(opts.versionId);
	const { summary } = pack;

	const row = insertInstance({
		name: opts.name,
		loader: summary.loader,
		mcVersion: summary.mcVersion,
		loaderVersion: summary.loaderVersion,
		port: opts.port,
		ramMinMb: Math.min(1024, opts.ramMaxMb),
		ramMaxMb: opts.ramMaxMb,
		jvmArgs: '',
		autoStart: false,
		eulaAccepted: true,
		installState: 'installing',
		packProjectId: summary.projectId,
		packVersionId: summary.versionId,
		packVersionNumber: summary.versionNumber,
		packName: summary.name,
		packIconUrl: summary.iconUrl
	});
	setProgress(row.id, { label: 'Starting', done: 0, total: 1 });
	void finishImport(row, pack);
	return row;
}

async function finishImport(row: typeof instances.$inferSelect, pack: LoadedPack) {
	const server = serverDir(row.id);
	try {
		setProgress(row.id, { label: 'Installing the server', done: 0, total: 1 });
		await installBase(row);

		await downloadFiles(row.id, server, pack.index.files.filter(wantsOnServer));

		setProgress(row.id, { label: 'Copying configuration', done: 0, total: 1 });
		const overrides = await extractOverrides(pack.zip, server);

		setProgress(row.id, { label: 'Recording mods', done: 0, total: 1 });
		await trackMods(row.id, pack.index.files.filter(wantsOnServer));
		writeManifest(row.id, { files: await packFileHashes(server, pack.index.files), overrides });

		db.update(instances)
			.set({ installState: 'ready', installMessage: null })
			.where(eq(instances.id, row.id))
			.run();
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[modpack] import of "${row.name}" (#${row.id}) failed: ${message}`);
		db.update(instances)
			.set({ installState: 'failed', installMessage: message.slice(0, 500) })
			.where(eq(instances.id, row.id))
			.run();
	} finally {
		clearProgress(row.id);
	}
}

export async function downloadFiles(instanceId: number, server: string, files: IndexFile[]) {
	let done = 0;
	const total = files.length;
	setProgress(instanceId, { label: 'Downloading mods', done, total });

	const queue = [...files];
	const worker = async () => {
		for (let file = queue.shift(); file; file = queue.shift()) {
			const dest = safeJoin(server, file.path);
			mkdirSync(dirname(dest), { recursive: true });
			await downloadWithFallback(dest, file);
			setProgress(instanceId, { label: 'Downloading mods', done: ++done, total });
		}
	};
	await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, total) }, worker));
}

export async function downloadWithFallback(dest: string, file: IndexFile) {
	const hash = file.hashes.sha512
		? ({ algo: 'sha512', value: file.hashes.sha512 } as const)
		: file.hashes.sha1
			? ({ algo: 'sha1', value: file.hashes.sha1 } as const)
			: undefined;
	if (!hash) throw new Error(`${file.path} has no checksum`);

	let lastError: unknown;
	for (const url of file.downloads) {
		const host = new URL(url).hostname;
		if (!ALLOWED_HOSTS.has(host)) {
			lastError = new Error(`Download host ${host} is not allowed for ${file.path}`);
			continue;
		}
		try {
			return await downloadFile(dest, { url, hash });
		} catch (e) {
			lastError = e;
		}
	}
	throw new Error(
		`Could not download ${file.path}: ${lastError instanceof Error ? lastError.message : 'no download URLs'}`
	);
}

/** The pack's config files by their path in the server, `server-overrides/` winning over `overrides/`. */
export function overrideEntries(zip: Zip) {
	const found = new Map<string, ZipEntry>();
	let total = 0;
	for (const prefix of ['overrides/', 'server-overrides/']) {
		for (const entry of zip.entries) {
			if (entry.isDir || !entry.name.startsWith(prefix)) continue;
			if (entry.size > MAX_FILE_BYTES) throw new Error(`${entry.name} is too large`);
			total += entry.size;
			if (total > MAX_EXTRACT_BYTES) throw new Error('The modpack unpacks to too much data');
			const rel = entry.name.slice(prefix.length);
			const safe = safeEntryName(rel.replaceAll('\\', '/'));
			if (isAbsolute(rel) || !safe) throw new Error(`Refusing unsafe path "${rel}"`);
			found.set(safe, entry);
		}
	}
	return found;
}

export const sha1Of = (bytes: Uint8Array) =>
	new Bun.CryptoHasher('sha1').update(bytes).digest('hex');

/** Copies the pack's config files into the server folder; returns the SHA-1 of each. */
async function extractOverrides(zip: Zip, server: string) {
	const hashes: Record<string, string> = {};
	for (const [rel, entry] of overrideEntries(zip)) {
		const bytes = zip.read(entry);
		const dest = safeJoin(server, rel);
		mkdirSync(dirname(dest), { recursive: true });
		await Bun.write(dest, bytes);
		hashes[rel] = sha1Of(bytes);
	}
	return hashes;
}

/** Records the pack's mods that Modrinth knows, so they show up (and can update) like any other. */
/** SHA-1 of each file the pack installs, from the index or, when it lists none, from the file itself. */
export async function packFileHashes(server: string, files: IndexFile[]) {
	const hashes: Record<string, string> = {};
	for (const file of files.filter(wantsOnServer))
		hashes[file.path] =
			file.hashes.sha1 ??
			sha1Of(new Uint8Array(await Bun.file(safeJoin(server, file.path)).arrayBuffer()));
	return hashes;
}

export async function trackMods(instanceId: number, files: IndexFile[]) {
	const jars = files.filter(
		(f) => /^(mods|plugins)\//.test(f.path) && f.path.endsWith('.jar') && f.hashes.sha512
	);
	if (!jars.length) return;

	const known = await modrinth.versionsByHashes(jars.map((f) => f.hashes.sha512!));
	const projectIds = [...new Set(Object.values(known).map((v) => v.project_id))];
	const projects = new Map<string, modrinth.ModrinthProject>();
	for (let i = 0; i < projectIds.length; i += 100)
		for (const p of await modrinth.getProjects(projectIds.slice(i, i + 100))) projects.set(p.id, p);

	const seen = new Set<string>();
	const rows: (typeof installedMods.$inferInsert)[] = [];
	for (const file of jars) {
		const version = known[file.hashes.sha512!];
		if (!version || seen.has(version.project_id)) continue;
		seen.add(version.project_id);
		const project = projects.get(version.project_id);
		rows.push({
			instanceId,
			kind: 'mod',
			source: 'modrinth',
			projectId: version.project_id,
			versionId: version.id,
			title: project?.title ?? version.project_id,
			iconUrl: project?.icon_url ?? null,
			versionNumber: version.version_number,
			clientSide: project?.client_side ?? null,
			serverSide: project?.server_side ?? null,
			file: file.path,
			hash: file.hashes.sha512!,
			dependencyOf: null
		});
	}
	if (rows.length) db.insert(installedMods).values(rows).onConflictDoNothing().run();
}

export async function searchModpacks(query: string, limit: number) {
	const res = await modrinth.searchProjects({
		query,
		loaders: [],
		type: 'modpack',
		// Modrinth's server-side flag is not reliable for packs: client-only mods are handled when
		// a pack is read, so every pack is listed
		serverSide: false,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

export type ModpackVersion = {
	id: string;
	versionNumber: string;
	versionType: 'release' | 'beta' | 'alpha';
	publishedAt: string;
	gameVersions: string[];
	loaders: string[];
};

/** All versions of a modpack, newest first. */
export async function listModpackVersions(projectId: string): Promise<ModpackVersion[]> {
	return (await modrinth.listVersions(projectId, [])).map((v) => ({
		id: v.id,
		versionNumber: v.version_number,
		versionType: v.version_type,
		publishedAt: v.date_published,
		gameVersions: v.game_versions,
		loaders: v.loaders
	}));
}

/** What importing this version would do, without creating anything. */
export async function previewModpack(versionId: string): Promise<ModpackSummary> {
	return (await loadModpack(versionId)).summary;
}

/** Fills in the icon of modpack instances created before it was kept; returns how many it filled. */
export async function backfillPackIcons() {
	const missing = db
		.select()
		.from(instances)
		.where(and(isNotNull(instances.packProjectId), isNull(instances.packIconUrl)))
		.all();
	if (!missing.length) return 0;
	const projects = await modrinth.getProjects([...new Set(missing.map((i) => i.packProjectId!))]);
	let filled = 0;
	for (const row of missing) {
		const icon = projects.find((p) => p.id === row.packProjectId)?.icon_url;
		if (!icon) continue;
		db.update(instances).set({ packIconUrl: icon }).where(eq(instances.id, row.id)).run();
		filled++;
	}
	return filled;
}
