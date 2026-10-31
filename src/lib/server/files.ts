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
import { SMALL_FILE_BYTES } from '../upload-limits';
import type { Actor } from './access';
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

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

// the text formats a server's configuration comes in
const EDITABLE =
	/\.(properties|json|json5|jsonc|toml|ya?ml|cfg|conf|ini|txt|mcmeta|xml|md|snbt|log)$/i;

export const isEditable = (name: string) => EDITABLE.test(name);

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
	if (stat.size > MAX_EDIT_BYTES)
		throw new Error('This file is too large to edit here (2 MB limit)');
	const bytes = readFileSync(absolute);
	if (bytes.includes(0)) throw new Error('This looks like a binary file');
	return { content: bytes.toString('utf8'), size: stat.size, modified: stat.mtimeMs };
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
