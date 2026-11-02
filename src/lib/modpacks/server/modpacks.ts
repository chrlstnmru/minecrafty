import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Loader } from '#lib/server/loaders.js';

import { sha1 } from '#lib/server/change-set.js';
import { dataDir } from '#lib/server/config.js';
import { db } from '#lib/server/db/index.js';
import { installedMods, instances } from '#lib/server/db/schema.js';
import { downloadFile } from '#lib/server/download.js';
import { runInstall, setProgress } from '#lib/server/install-progress.js';
import { installBase, insertInstance, serverDir, type NewInstance } from '#lib/server/instances.js';
import * as modrinth from '#lib/server/modrinth.js';

import { writeManifest } from './modpack-manifest';
import { readMrpack, safeJoin, type IndexFile, type Mrpack } from './mrpack';

// Modpacks from Modrinth: finding them, fetching a version's .mrpack, and making an instance
// from a pack (a Modrinth one, or a builder pack read the same way).

const MAX_PACK_BYTES = 600 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;

// the hosts the .mrpack format allows downloads from
const ALLOWED_HOSTS = new Set([
	'cdn.modrinth.com',
	'github.com',
	'raw.githubusercontent.com',
	'gitlab.com'
]);

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
	/** of those, the ones the pack marks as not running on a server */
	clientOnly: number;
	downloadBytes: number;
	/** files copied straight from the pack (configs, scripts, ...) */
	overrides: number;
};

export type LoadedPack = { summary: ModpackSummary; mrpack: Mrpack };

/** What a pack is, for the pages: the counts come from the pack, the names from where it was found. */
export function summarize(
	mrpack: Mrpack,
	origin: Pick<ModpackSummary, 'projectId' | 'versionId' | 'versionNumber' | 'name' | 'iconUrl'>
): ModpackSummary {
	return {
		...origin,
		summary: mrpack.summary,
		mcVersion: mrpack.mcVersion,
		loader: mrpack.loader,
		loaderVersion: mrpack.loaderVersion,
		files: mrpack.files.length,
		clientOnly: mrpack.files.filter((f) => f.env?.server === 'unsupported').length,
		downloadBytes: mrpack.files.reduce((sum, f) => sum + (f.fileSize ?? 0), 0),
		overrides: mrpack.overrides.size
	};
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
	const mrpack = readMrpack(new Uint8Array(await Bun.file(path).arrayBuffer()));
	const info = await projectInfo(version.project_id, mrpack.name);
	return {
		mrpack,
		summary: summarize(mrpack, {
			projectId: version.project_id,
			versionId: version.id,
			versionNumber: mrpack.versionNumber,
			name: info.name,
			iconUrl: info.iconUrl
		})
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
	const pack = await loadModpack(opts.versionId);
	const { summary } = pack;
	return startImportLoaded(pack, opts, {
		packProjectId: summary.projectId,
		packVersionId: summary.versionId,
		packVersionNumber: summary.versionNumber,
		packName: summary.name,
		packIconUrl: summary.iconUrl
	});
}

/** The same, for a pack already in memory; `origin` is what the instance records about where it came from. */
export async function startImportLoaded(
	pack: LoadedPack,
	opts: Omit<ImportOptions, 'versionId'>,
	origin: Partial<NewInstance>
) {
	if (!opts.eulaAccepted) throw new Error('You must accept the Minecraft EULA');
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
		...origin
	});
	setProgress(row.id, { label: 'Starting', done: 0, total: 1 });
	void finishImport(row, pack);
	return row;
}

function finishImport(row: typeof instances.$inferSelect, pack: LoadedPack) {
	const server = serverDir(row.id);
	return runInstall(row, 'modpack import', async () => {
		setProgress(row.id, { label: 'Installing the server', done: 0, total: 1 });
		await installBase(row);

		await downloadFiles(row.id, server, pack.mrpack.files);

		setProgress(row.id, { label: 'Copying configuration', done: 0, total: 1 });
		const overrides = await extractOverrides(pack.mrpack, server);

		setProgress(row.id, { label: 'Recording mods', done: 0, total: 1 });
		await trackMods(row.id, pack.mrpack.files);
		writeManifest(row.id, {
			files: await packFileHashes(server, pack.mrpack.files),
			overrides
		});
	});
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

/** Copies the pack's config files into the server folder; returns the SHA-1 of each. */
async function extractOverrides(mrpack: Mrpack, server: string) {
	const hashes: Record<string, string> = {};
	for (const [rel, entry] of mrpack.overrides) {
		const bytes = mrpack.read(entry);
		const dest = safeJoin(server, rel);
		mkdirSync(dirname(dest), { recursive: true });
		await Bun.write(dest, bytes);
		hashes[rel] = sha1(bytes);
	}
	return hashes;
}

/** SHA-1 of each file the pack installs, from the index or, when it lists none, from the file itself. */
export async function packFileHashes(server: string, files: IndexFile[]) {
	const hashes: Record<string, string> = {};
	for (const file of files)
		hashes[file.path] =
			file.hashes.sha1 ??
			sha1(new Uint8Array(await Bun.file(safeJoin(server, file.path)).arrayBuffer()));
	return hashes;
}

/** Records the pack's mods that Modrinth knows, so they show up (and can update) like any other. */
export async function trackMods(instanceId: number, files: IndexFile[]) {
	const jars = files.filter(
		(f) => /^(mods|plugins)\//.test(f.path) && f.path.endsWith('.jar') && f.hashes.sha512
	);
	if (!jars.length) return;

	const known = await modrinth.versionsByHashes(jars.map((f) => f.hashes.sha512!));
	const projects = new Map(
		(await modrinth.getProjects(Object.values(known).map((v) => v.project_id))).map((p) => [
			p.id,
			p
		])
	);

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
