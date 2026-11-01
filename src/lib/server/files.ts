import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { Actor } from './access';
import type { ZipEntry } from './zip-writer';

import { assertEditableSize, decodeText, isEditable, MAX_EDIT_BYTES } from '../editable';
import { topLevelPaths } from '../file-tree';
import { SMALL_FILE_BYTES } from '../upload-limits';
import { assertMayWriteCode } from './host-code';
import { getInstance, serverDir } from './instances';
import { isRunning } from './live-server';
import { assertWritable } from './operations';
import {
	assertMutable,
	assertWorldIdle,
	isProtected,
	isRewrittenOnStop,
	isWorldPath
} from './protected-files';
import { readProperties } from './server-properties';
import { listZipEntries } from './zip-entries';

// Everything the file manager does stays inside an instance's server folder. Every path is
// resolved through `resolveSafe`, which refuses `..`, absolute paths and symlinks pointing out.

export type FileEntry = {
	name: string;
	kind: 'dir' | 'file' | 'link';
	size: number;
	modified: number;
	/** part of the server install: it cannot be deleted, renamed or replaced */
	locked: boolean;
	/** inside a world folder: changing it under a running server corrupts it */
	inWorld: boolean;
	/** the server writes this file back when it stops, so edits made while it runs are lost */
	rewritten: boolean;
};

export { isEditable, MAX_EDIT_BYTES };

/** What a save builds on: the hash of the text as it was read, to tell a file changed since. */
const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

function root(instanceId: number) {
	if (!getInstance(instanceId)) throw new Error('Instance not found');
	const dir = serverDir(instanceId);
	mkdirSync(dir, { recursive: true });
	return realpathSync(dir);
}

const inside = (base: string, path: string) => path === base || path.startsWith(base + sep);

/**
 * The absolute path for a path relative to the instance's server folder. Throws for anything
 * that would land outside it, including through a symlink (checked on the deepest part that
 * already exists, so creating new files works too).
 */
export function resolveSafe(instanceId: number, rel: string) {
	const base = root(instanceId);
	if (rel.includes('\0')) throw new Error('Invalid path');
	const clean = rel.replaceAll('\\', '/');
	if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..'))
		throw new Error('That path is not allowed');

	const absolute = resolve(base, clean);
	if (!inside(base, absolute)) throw new Error('That path is not allowed');

	let probe = absolute;
	while (!existsSync(probe)) probe = dirname(probe);
	if (!inside(base, realpathSync(probe))) throw new Error('That path leaves the instance folder');
	return { base, absolute, rel: relative(base, absolute).split(sep).join('/') };
}

/** The world folder's name from server.properties (`world` when unset). */
function levelName(instanceId: number) {
	try {
		return (
			readProperties(join(serverDir(instanceId), 'server.properties'))['level-name'] || 'world'
		);
	} catch {
		return 'world';
	}
}

/** Refuses to change the world (delete, rename, replace files in it) while the server runs. */
export async function assertWorldStopped(instanceId: number, rel: string, action: string) {
	const { rel: normalized } = resolveSafe(instanceId, rel);
	if (!isWorldPath(normalized, levelName(instanceId))) return;
	assertWorldIdle(normalized, levelName(instanceId), await isRunning(instanceId), action);
}

export function listDirectory(instanceId: number, rel: string) {
	const { absolute, rel: normalized } = resolveSafe(instanceId, rel);
	if (!statSync(absolute).isDirectory()) throw new Error('Not a folder');

	const level = levelName(instanceId);
	const entries: FileEntry[] = readdirSync(absolute).map((name) => {
		const stat = lstatSync(join(absolute, name));
		return {
			name,
			kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : 'file',
			size: stat.isDirectory() ? 0 : stat.size,
			modified: stat.mtimeMs,
			locked: isProtected(join(normalized, name)),
			inWorld: isWorldPath(join(normalized, name), level),
			rewritten: isRewrittenOnStop(join(normalized, name))
		};
	});
	entries.sort(
		(a, b) =>
			Number(b.kind === 'dir') - Number(a.kind === 'dir') ||
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
	);
	return { path: normalized, entries };
}

export function readTextFile(instanceId: number, rel: string) {
	const { absolute } = resolveSafe(instanceId, rel);
	const stat = statSync(absolute);
	if (!stat.isFile()) throw new Error('Not a file');
	assertEditableSize(stat.size);
	const bytes = readFileSync(absolute);
	return { content: decodeText(bytes), size: stat.size, modified: stat.mtimeMs, hash: sha1(bytes) };
}

export function writeTextFile(instanceId: number, rel: string, content: string) {
	const { absolute } = resolveSafe(instanceId, rel);
	if (!isEditable(basename(absolute))) throw new Error('This file type cannot be edited here');
	if (Buffer.byteLength(content) > MAX_EDIT_BYTES)
		throw new Error('The file is too large (2 MB limit)');
	if (existsSync(absolute) && !statSync(absolute).isFile()) throw new Error('Not a file');
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, content);
}

/** A new name may not carry a path: it is one entry in one folder. */
function checkName(name: string) {
	if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 255)
		throw new Error('Use a plain file name, without slashes');
	return name;
}

export function makeDirectory(instanceId: number, parentRel: string, name: string) {
	const { absolute, rel } = resolveSafe(instanceId, join(parentRel, checkName(name)));
	assertMutable(rel, 'replaced');
	if (existsSync(absolute)) throw new Error(`${name} already exists`);
	mkdirSync(absolute, { recursive: true });
}

export function createTextFile(instanceId: number, parentRel: string, name: string) {
	const { absolute, rel } = resolveSafe(instanceId, join(parentRel, checkName(name)));
	assertMutable(rel, 'replaced');
	if (!isEditable(name)) throw new Error('This file type cannot be edited here');
	if (existsSync(absolute)) throw new Error(`${name} already exists`);
	writeFileSync(absolute, '');
}

export function renameEntry(instanceId: number, rel: string, newName: string) {
	const from = resolveSafe(instanceId, rel);
	if (from.absolute === from.base) throw new Error('The instance folder itself cannot be renamed');
	const to = resolveSafe(instanceId, join(dirname(from.rel), checkName(newName)));
	assertMutable(from.rel, 'renamed');
	assertMutable(to.rel, 'replaced');
	if (existsSync(to.absolute)) throw new Error(`${newName} already exists`);
	renameSync(from.absolute, to.absolute);
}

export function deleteEntry(instanceId: number, rel: string) {
	const { absolute, base, rel: normalized } = resolveSafe(instanceId, rel);
	if (absolute === base) throw new Error('The instance folder itself cannot be deleted');
	assertMutable(normalized, 'deleted');
	rmSync(absolute, { recursive: true, force: true });
}

// What a person may do to the server folder. One function per file manager action, each applying
// every rule that action is subject to, so a route cannot forget one: protected install files
// (inside the primitives above), code files for the owner alone, a world left alone while the
// server runs, and no changes while a restore or an install or update is working on the folder.

/** Saves the text of a file (an existing protected file such as eula.txt may be edited). */
export function saveFile(actor: Actor, instanceId: number, rel: string, content: string) {
	assertWritable(instanceId);
	assertMayWriteCode(actor, rel);
	writeTextFile(instanceId, rel, content);
}

export function addFolder(instanceId: number, parentRel: string, name: string) {
	assertWritable(instanceId);
	makeDirectory(instanceId, parentRel, name);
}

export function addFile(actor: Actor, instanceId: number, parentRel: string, name: string) {
	assertWritable(instanceId);
	assertMayWriteCode(actor, name);
	createTextFile(instanceId, parentRel, name);
}

export async function moveEntry(actor: Actor, instanceId: number, rel: string, newName: string) {
	assertWritable(instanceId);
	assertMayWriteCode(actor, newName);
	await assertWorldStopped(instanceId, rel, 'renaming');
	renameEntry(instanceId, rel, newName);
}

export async function removeEntry(instanceId: number, rel: string) {
	assertWritable(instanceId);
	await assertWorldStopped(instanceId, rel, 'deleting from');
	deleteEntry(instanceId, rel);
}

/** Every file under a path, as paths relative to the server folder; a file is just itself. */
function filesUnder(instanceId: number, rel: string): string[] {
	const { absolute, base } = resolveSafe(instanceId, rel);
	const stat = lstatSync(absolute);
	if (stat.isSymbolicLink()) return [];
	if (!stat.isDirectory()) return [relative(base, absolute).split(sep).join('/')];
	return readdirSync(absolute, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(base, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

const exists = (absolute: string) => {
	try {
		lstatSync(absolute);
		return true;
	} catch {
		return false;
	}
};

/** Runs a check on one item of a batch, so a refusal names the item it is about. */
async function onItem<T>(rel: string, check: () => T | Promise<T>): Promise<T> {
	try {
		return await check();
	} catch (e) {
		throw new Error(`${rel}: ${e instanceof Error ? e.message : 'not allowed'}`);
	}
}

/**
 * Saves several edited files together, all or none: every file is checked as `saveFile` would
 * (and must still be the text it was opened as, by `baseHash`) before the first is written, and a
 * refusal names the file. Returns how many files changed, and each file's hash as it is now.
 */
export async function saveFiles(
	actor: Actor,
	instanceId: number,
	list: { rel: string; content: string; baseHash: string }[]
) {
	assertWritable(instanceId);
	const prepared: { rel: string; absolute: string; bytes: Buffer; changed: boolean }[] = [];
	const seen = new Set<string>();
	for (const { rel, content, baseHash } of list) {
		prepared.push(
			await onItem(rel, () => {
				assertMayWriteCode(actor, rel);
				const target = resolveSafe(instanceId, rel);
				if (seen.has(target.rel)) throw new Error('is in the list twice');
				seen.add(target.rel);
				if (!isEditable(basename(target.absolute)))
					throw new Error('This file type cannot be edited here');
				const bytes = Buffer.from(content, 'utf8');
				if (bytes.length > MAX_EDIT_BYTES) throw new Error('The file is too large (2 MB limit)');
				const stale = new Error(
					'This file changed since you opened it. Reload it to see the new version.'
				);
				if (!exists(target.absolute) || !statSync(target.absolute).isFile()) throw stale;
				assertEditableSize(statSync(target.absolute).size);
				const current = readFileSync(target.absolute);
				if (sha1(current) !== baseHash) throw stale;
				return {
					rel: target.rel,
					absolute: target.absolute,
					bytes,
					changed: Buffer.compare(current, bytes) !== 0
				};
			})
		);
	}
	for (const file of prepared) if (file.changed) writeFileSync(file.absolute, file.bytes);
	return {
		changed: prepared.filter((file) => file.changed).length,
		hashes: Object.fromEntries(prepared.map((file) => [file.rel, sha1(file.bytes)]))
	};
}

/**
 * Deletes files and folders (a folder with all in it) together, all or none: each is checked as
 * `removeEntry` would be before the first goes. Returns how many were chosen.
 */
export async function removeEntries(instanceId: number, paths: string[]) {
	assertWritable(instanceId);
	const chosen = topLevelPaths(paths.map((p) => p.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')));
	if (!chosen.length) throw new Error('Choose a file or folder');
	const absolutes: string[] = [];
	for (const rel of chosen)
		absolutes.push(
			await onItem(rel, async () => {
				await assertWorldStopped(instanceId, rel, 'deleting from');
				const { absolute, base, rel: normalized } = resolveSafe(instanceId, rel);
				if (absolute === base) throw new Error('The instance folder itself cannot be deleted');
				assertMutable(normalized, 'deleted');
				if (!exists(absolute)) throw new Error('not found');
				return absolute;
			})
		);
	for (const absolute of absolutes) rmSync(absolute, { recursive: true, force: true });
	return chosen.length;
}

/**
 * Moves files and folders into `folder` ('' is the server folder), each keeping its name, all or
 * none. Each move is checked as `moveEntry` is, and since a folder arrives with everything in it,
 * every file inside is checked for the owner-only code rule at its new place. Items already in
 * `folder` are left alone. Returns how many moved.
 */
export async function moveEntries(
	actor: Actor,
	instanceId: number,
	paths: string[],
	folder: string
) {
	assertWritable(instanceId);
	const clean = (p: string) => p.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
	const chosen = topLevelPaths(paths.map(clean));
	if (!chosen.length) throw new Error('Choose a file or folder');
	const target = resolveSafe(instanceId, clean(folder));
	if (exists(target.absolute) && !statSync(target.absolute).isDirectory())
		throw new Error(`${folder} is a file`);

	const moves: { source: string; dest: string }[] = [];
	const names = new Set<string>();
	for (const rel of chosen) {
		const move = await onItem(rel, async () => {
			const from = resolveSafe(instanceId, rel);
			if (from.absolute === from.base)
				throw new Error('The instance folder itself cannot be moved');
			if (!exists(from.absolute)) throw new Error('not found');
			const name = basename(from.rel);
			const to = resolveSafe(instanceId, join(target.rel, name));
			if (to.absolute === from.absolute) return null;
			if (inside(from.absolute, target.absolute)) throw new Error('cannot be moved into itself');
			if (names.has(name)) throw new Error(`Two of the items are called ${name}`);
			names.add(name);
			assertMutable(from.rel, 'moved');
			assertMutable(to.rel, 'replaced');
			await assertWorldStopped(instanceId, from.rel, 'moving from');
			await assertWorldStopped(instanceId, to.rel, 'moving into');
			if (exists(to.absolute)) throw new Error(`${to.rel} already exists`);
			for (const file of filesUnder(instanceId, from.rel))
				assertMayWriteCode(actor, join(to.rel, relative(from.rel, file)));
			return { source: from.absolute, dest: to.absolute };
		});
		if (move) moves.push(move);
	}
	if (!moves.length) return 0;
	mkdirSync(target.absolute, { recursive: true });
	resolveSafe(instanceId, target.rel);
	for (const { source, dest } of moves) renameSync(source, dest);
	return moves.length;
}

/** The entries of a zip of the chosen files and folders, named by their path in the server folder. */
export function describeSelection(instanceId: number, paths: string[]) {
	const chosen = topLevelPaths(paths.map((p) => p.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')));
	if (!chosen.length) throw new Error('Choose a file or folder');
	const entries: ZipEntry[] = [];
	for (const rel of chosen) {
		const { absolute, rel: normalized } = resolveSafe(instanceId, rel);
		if (!exists(absolute)) throw new Error(`${rel} not found`);
		const stat = lstatSync(absolute);
		if (stat.isFile()) {
			entries.push({ kind: 'file', name: normalized, path: absolute, modified: stat.mtime });
		} else if (stat.isDirectory()) {
			entries.push({ kind: 'dir', name: normalized, modified: stat.mtime });
			for (const entry of listZipEntries(absolute))
				entries.push({ ...entry, name: `${normalized}/${entry.name}` });
		}
	}
	return { entries, name: 'files.zip' };
}

/** Whether `actor` may put a file at `relPath` below `dirRel` now. Checked when an upload begins and again when it finishes. */
export async function assertMayUpload(
	actor: Actor,
	instanceId: number,
	dirRel: string,
	relPath: string
) {
	assertWritable(instanceId);
	assertMayWriteCode(actor, relPath);
	await assertWorldStopped(instanceId, join(dirRel, relPath), 'uploading into');
}

/**
 * Saves small uploaded files below `dirRel`. All or nothing as far as the rules go: the batch is
 * refused before any of it is written. `onSaved` hears of each file as it lands.
 */
export async function uploadFiles(
	actor: Actor,
	instanceId: number,
	dirRel: string,
	items: { file: File; path: string }[],
	onSaved: (relPath: string) => void
) {
	assertWritable(instanceId);
	for (const item of items) assertMayWriteCode(actor, item.path);
	for (const { file, path } of items) {
		await assertWorldStopped(instanceId, join(dirRel, path), 'uploading into');
		await saveUpload(instanceId, dirRel, file, path);
		onSaved(path);
	}
}

/**
 * Where an uploaded file goes: `relPath` is its path inside a dropped folder (`pack/mods/a.jar`),
 * created below `dirRel`. Every part must be a plain name, so it can never climb out, and the
 * result is checked through symlinks. Used by both small-file and chunked uploads.
 */
export function uploadTarget(instanceId: number, dirRel: string, relPath: string) {
	const { absolute: dir, base } = resolveSafe(instanceId, dirRel);
	if (!statSync(dir).isDirectory()) throw new Error('Not a folder');

	const raw = relPath.replaceAll('\\', '/');
	// same rule as every other path here: relative to the folder, never absolute
	if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new Error('That path is not allowed');
	const parts = raw.split('/').filter(Boolean);
	if (!parts.length) throw new Error('The file has no name');
	for (const part of parts) checkName(part);

	const target = resolveSafe(instanceId, join(relative(base, dir), ...parts));
	assertMutable(target.rel, 'replaced');
	return { ...target, shown: parts.join('/') };
}

/** Creates the folders a target needs, then checks again: one of them could be a link pointing out. */
export function prepareTarget(instanceId: number, target: ReturnType<typeof uploadTarget>) {
	mkdirSync(dirname(target.absolute), { recursive: true });
	resolveSafe(instanceId, target.rel);
	if (existsSync(target.absolute) && !statSync(target.absolute).isFile())
		throw new Error(`${target.shown} is a folder`);
}

/** Saves a small uploaded file into a folder, replacing a file of the same name. */
export async function saveUpload(instanceId: number, dirRel: string, file: File, relPath?: string) {
	if (file.size > SMALL_FILE_BYTES * 2)
		throw new Error(`${file.name} is too large for this route, it should be sent in pieces`);
	const target = uploadTarget(instanceId, dirRel, relPath ?? file.name);
	prepareTarget(instanceId, target);

	// Kit's lazily read upload must be streamed: handed to Bun.write as is, it is written as text
	await Bun.write(target.absolute, new Response(file.stream()));
	if (statSync(target.absolute).size !== file.size) {
		rmSync(target.absolute, { force: true });
		throw new Error(`${target.shown} was not received completely, try again`);
	}
	return target.shown;
}

/** What a download of this path is: a file as it is, or a folder as a zip of its contents. */
export function describeDownload(instanceId: number, rel: string) {
	const { absolute, base } = resolveSafe(instanceId, rel);
	const stat = statSync(absolute);
	if (stat.isFile()) return { kind: 'file' as const, path: absolute, name: basename(absolute) };
	if (!stat.isDirectory()) throw new Error('Nothing to download');

	const entries = listZipEntries(absolute);
	return {
		kind: 'folder' as const,
		entries,
		name: `${absolute === base ? 'server' : basename(absolute)}.zip`
	};
}
