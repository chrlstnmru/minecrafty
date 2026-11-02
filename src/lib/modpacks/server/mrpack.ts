import { isAbsolute, resolve, sep } from 'node:path';

import type { Loader } from '#lib/server/loaders.js';

import { safeEntryName } from '#lib/safe-entry-name.js';
import { Zip, type ZipEntry } from '#lib/server/zip.js';

// The Modrinth modpack format (.mrpack): a zip with modrinth.index.json (the files to download),
// and config files in overrides/ (both sides), server-overrides/ and client-overrides/.

const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

const LOADER_KEYS: [string, Loader][] = [
	['fabric-loader', 'fabric'],
	['quilt-loader', 'quilt'],
	['neoforge', 'neoforge'],
	['forge', 'forge']
];

export type IndexFile = {
	path: string;
	hashes: { sha1?: string; sha512?: string };
	env?: { client?: string; server?: string };
	downloads: string[];
	fileSize?: number;
};

export type PackIndex = {
	formatVersion: number;
	game: string;
	name: string;
	versionId: string;
	summary?: string;
	files: IndexFile[];
	dependencies: Record<string, string>;
};

/** What an index says about the pack itself, apart from its files. */
export type PackFields = {
	name: string;
	summary: string;
	versionNumber: string;
	mcVersion: string;
	/** `vanilla` when the pack names no loader */
	loader: Loader;
	loaderVersion: string | null;
};

export type Mrpack = PackFields & {
	/** every file the index lists */
	files: IndexFile[];
	/** the files a server installs: all but the client-only ones */
	serverFiles: IndexFile[];
	/** the config files a server gets, by their path in the server; `server-overrides/` wins over `overrides/` */
	overrides: Map<string, ZipEntry>;
	/** the config files in these folders, each by its path with its folder (`client-overrides/options.txt`) */
	configs(folders: readonly string[]): Map<string, ZipEntry>;
	read(entry: ZipEntry): Uint8Array;
};

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

/** The config files in these folders of the pack, each by its path inside its folder, a later folder winning. */
function entriesIn(
	zip: Zip,
	folders: readonly string[],
	keep: (folder: string, rel: string) => string
) {
	const found = new Map<string, ZipEntry>();
	let total = 0;
	for (const folder of folders) {
		const prefix = `${folder}/`;
		for (const entry of zip.entries) {
			if (entry.isDir || !entry.name.startsWith(prefix)) continue;
			if (entry.size > MAX_FILE_BYTES) throw new Error(`${entry.name} is too large`);
			total += entry.size;
			if (total > MAX_EXTRACT_BYTES) throw new Error('The modpack unpacks to too much data');
			const rel = entry.name.slice(prefix.length);
			const safe = safeEntryName(rel.replaceAll('\\', '/'));
			if (isAbsolute(rel) || !safe) throw new Error(`Refusing unsafe path "${rel}"`);
			found.set(keep(folder, safe), entry);
		}
	}
	return found;
}

/**
 * Reads a .mrpack and checks it: the index's size and format, and that every config file has a
 * safe path and a sane size. The paths of the index's files are checked where they are written.
 */
export function readMrpack(bytes: Uint8Array): Mrpack {
	const zip = new Zip(bytes);
	const index = parseIndex(zip);
	const found = LOADER_KEYS.find(([key]) => index.dependencies[key]);
	return {
		name: index.name,
		summary: index.summary ?? '',
		versionNumber: index.versionId,
		mcVersion: index.dependencies.minecraft,
		loader: found?.[1] ?? 'vanilla',
		loaderVersion: found ? index.dependencies[found[0]] : null,
		files: index.files,
		serverFiles: index.files.filter((f) => f.env?.server !== 'unsupported'),
		overrides: entriesIn(zip, ['overrides', 'server-overrides'], (_, rel) => rel),
		configs: (folders) => entriesIn(zip, folders, (folder, rel) => `${folder}/${rel}`),
		read: (entry) => zip.read(entry)
	};
}

/** The index of a pack with these fields and files. A vanilla pack names no loader. */
export function writeIndex(pack: PackFields, files: IndexFile[]): PackIndex {
	const dependencies: Record<string, string> = { minecraft: pack.mcVersion };
	const key = LOADER_KEYS.find(([, loader]) => loader === pack.loader)?.[0];
	if (key && pack.loaderVersion) dependencies[key] = pack.loaderVersion;
	return {
		formatVersion: 1,
		game: 'minecraft',
		versionId: pack.versionNumber,
		name: pack.name,
		summary: pack.summary,
		files,
		dependencies
	};
}
