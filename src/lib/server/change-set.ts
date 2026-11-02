// Applying a set of file changes to a folder, all or none: the instance file manager and a pack's
// config files both go through here. What may change where is the caller's rules.

import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { isEditable, MAX_EDIT_BYTES } from '../editable';
import { under } from '../paths';
import { ChangeRefused, refusal, StaleFile } from './http';

export type Changes = {
	/** Files or folders to move; a folder moves with everything in it. */
	moves: { from: string; to: string }[];
	/** Files or folders to delete. */
	deletes: string[];
	/**
	 * Texts to write, at the path the file ends up at. A file that exists says where it is now
	 * (`original`) and the hash of the text it was opened as (`baseHash`); a new file says neither.
	 */
	writes: { path: string; content: string; original?: string; baseHash?: string }[];
};

/** What may change in a folder. Each check throws, with text for the user, to refuse. */
export type ChangeRules = {
	/** The folder the paths are in. */
	root: string;
	/** Whether the item at `path` may leave it, by being moved away or deleted. */
	mayTake(path: string, how: 'moved' | 'deleted'): void | Promise<void>;
	/**
	 * Whether an item may arrive at `path`: a moved file or folder (`files` are the files it brings,
	 * at their new paths) or a new file.
	 */
	mayPlace(path: string, files: string[]): void | Promise<void>;
	/** Whether the text of the file at `path`, which exists, may be written. */
	mayEdit(path: string): void | Promise<void>;
	/** Removes a folder a move or delete leaves empty, up to the root. */
	pruneEmpty?: boolean;
};

export const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

const inside = (base: string, path: string) => path === base || path.startsWith(base + sep);

const exists = (absolute: string) => {
	try {
		lstatSync(absolute);
		return true;
	} catch {
		return false;
	}
};

/**
 * The absolute path of `rel` inside `root`, and `rel` tidied. Throws for anything that would land
 * outside it, including through a symlink (checked on the deepest part that already exists, so a
 * new file works too).
 */
export function safePath(root: string, rel: string) {
	const base = realpathSync(root);
	if (rel.includes('\0')) throw new Error('Invalid path');
	const clean = rel.replaceAll('\\', '/');
	if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..'))
		throw new Error('That path is not allowed');
	const absolute = resolve(base, clean);
	if (!inside(base, absolute)) throw new Error('That path is not allowed');
	let probe = absolute;
	while (!existsSync(probe)) probe = dirname(probe);
	if (!inside(base, realpathSync(probe))) throw new Error('That path leaves the folder');
	return { base, absolute, rel: relative(base, absolute).split(sep).join('/') };
}

/** Every file under `rel` (a file is just itself), as paths relative to the root. */
function filesUnder(base: string, rel: string): string[] {
	const absolute = join(base, rel);
	const stat = lstatSync(absolute);
	if (stat.isSymbolicLink() || !stat.isDirectory()) return [rel];
	return readdirSync(absolute, { recursive: true, withFileTypes: true })
		.filter((entry) => !entry.isDirectory())
		.map((entry) => relative(base, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** Runs one item's checks so a refusal names it. */
async function named<T>(path: string, check: () => T | Promise<T>): Promise<T> {
	try {
		return await check();
	} catch (e) {
		throw refusal(path, e);
	}
}

/**
 * Applies the changes together, all or none. Everything is checked before anything is touched:
 * every item must be where it is said to be, nothing may land on a name that is taken (an item
 * moved away or deleted frees its name, so items can swap places), an edited file must still be
 * the text it was opened as, and `rules` must allow each step. A refusal is a `ChangeRefused`
 * naming the path. Moves go first, then deletes, then writes. Returns how many items changed, and
 * the hash of each written text as it is now.
 */
export async function applyChanges(rules: ChangeRules, changes: Changes) {
	const { root } = rules;
	const base = realpathSync(root);
	const at = (rel: string) => join(base, rel);

	const moves: { from: string; to: string; files: string[] }[] = [];
	const gone = new Set<string>();
	const isGone = (path: string) => [...gone].some((taken) => under(path, taken));

	for (const move of changes.moves) {
		const from = await named(move.from, () => safePath(base, move.from).rel);
		const to = await named(move.to, () => safePath(base, move.to).rel);
		if (from === to) continue;
		await named(from, async () => {
			if (!from) throw new Error('The folder itself cannot be moved');
			if (!exists(at(from))) throw new Error('not found');
			if (gone.has(from)) throw new Error('is moved twice');
			if (isGone(from) || [...gone].some((taken) => under(taken, from)))
				throw new Error('is inside another item that moves');
			if (under(to, from)) throw new Error('cannot be moved into itself');
			await rules.mayTake(from, 'moved');
		});
		gone.add(from);
		moves.push({ from, to, files: [] });
	}
	const deletes: string[] = [];
	for (const path of changes.deletes) {
		const rel = await named(path, () => safePath(base, path).rel);
		await named(rel, async () => {
			if (!rel) throw new Error('The folder itself cannot be deleted');
			if (!exists(at(rel))) throw new Error('not found');
			if (moves.some((move) => under(rel, move.from))) throw new Error('is moved and deleted');
			if (isGone(rel)) return;
			await rules.mayTake(rel, 'deleted');
		});
		// inside a folder that is deleted too
		if (isGone(rel)) continue;
		gone.add(rel);
		deletes.push(rel);
	}

	// where things will be: each path taken by a move or a new file, and whether it is a file
	const placed = new Map<string, boolean>();
	/** Whether something not moved away or deleted is still at `path`. */
	const occupied = (path: string): boolean => {
		if (isGone(path) || !exists(at(path))) return false;
		const stat = lstatSync(at(path));
		if (!stat.isDirectory()) return true;
		return readdirSync(at(path)).some((name) => occupied(path ? `${path}/${name}` : name));
	};
	const place = (path: string, isFile: boolean) => {
		if (!path) throw new ChangeRefused(path, 'A file needs a name');
		if (placed.has(path) || occupied(path))
			throw new ChangeRefused(
				path,
				isFile && !placed.has(path) && lstatSync(at(path)).isDirectory()
					? 'is a folder'
					: 'already exists'
			);
		for (const other of placed.keys())
			if (other.startsWith(`${path}/`)) throw new ChangeRefused(path, 'is a folder');
		for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) {
			if (placed.get(dir) === true) throw new ChangeRefused(dir, 'is a file');
			if (!isGone(dir) && exists(at(dir)) && !lstatSync(at(dir)).isDirectory())
				throw new ChangeRefused(dir, 'is a file');
		}
		placed.set(path, isFile);
	};

	for (const move of moves) {
		const isFile = !lstatSync(at(move.from)).isDirectory();
		place(move.to, isFile);
		move.files = filesUnder(base, move.from).map(
			(file) => `${move.to}${file.slice(move.from.length)}`
		);
		await named(move.from, () => rules.mayPlace(move.to, move.files));
	}

	const writes: { path: string; bytes: Buffer; changed: boolean }[] = [];
	const written = new Set<string>();
	for (const write of changes.writes) {
		const path = await named(write.path, () => safePath(base, write.path).rel);
		writes.push(
			await named(path, async () => {
				if (written.has(path)) throw new Error('is in the list twice');
				written.add(path);
				if (!isEditable(basename(path))) throw new Error('This file type cannot be edited here');
				const bytes = Buffer.from(write.content, 'utf8');
				if (bytes.length > MAX_EDIT_BYTES) throw new Error('The file is too large (2 MB limit)');
				if (write.original === undefined) {
					place(path, true);
					await rules.mayPlace(path, [path]);
					return { path, bytes, changed: true };
				}
				await rules.mayEdit(path);
				const original = safePath(base, write.original).rel;
				if (
					!exists(at(original)) ||
					!statSync(at(original)).isFile() ||
					deletes.some((deleted) => under(original, deleted))
				)
					throw new StaleFile();
				const moved = moves.find((move) => under(original, move.from));
				const target = moved ? `${moved.to}${original.slice(moved.from.length)}` : original;
				if (target !== path) throw new Error('does not go where it was moved to');
				const current = readFileSync(at(original));
				if (sha1(current) !== write.baseHash) throw new StaleFile();
				return { path, bytes, changed: Buffer.compare(current, bytes) !== 0 };
			})
		);
	}

	const changed = moves.length + deletes.length + writes.filter((w) => w.changed).length;
	if (moves.length || deletes.length) {
		// moves go through a folder of their own, so an item can move onto the place another one leaves
		const parking = moves.length ? mkdtempSync(join(base, '.moving-')) : undefined;
		try {
			for (const [index, { from }] of moves.entries())
				renameSync(at(from), join(parking!, String(index)));
			for (const path of deletes) rmSync(at(path), { recursive: true, force: true });
			for (const [index, { to }] of moves.entries()) {
				mkdirSync(dirname(at(to)), { recursive: true });
				// the folders just made must not lead out through a symlink put there meanwhile
				safePath(base, to);
				renameSync(join(parking!, String(index)), at(to));
			}
		} finally {
			if (parking) rmSync(parking, { recursive: true, force: true });
		}
	}
	for (const write of writes.filter((w) => w.changed)) {
		mkdirSync(dirname(at(write.path)), { recursive: true });
		writeFileSync(at(write.path), write.bytes);
	}
	if (rules.pruneEmpty)
		for (const path of [...moves.map((move) => move.from), ...deletes])
			for (let dir = dirname(at(path)); dir !== base && inside(base, dir); dir = dirname(dir)) {
				if (!existsSync(dir) || readdirSync(dir).length) break;
				rmSync(dir, { recursive: true, force: true });
			}

	return {
		changed,
		hashes: Object.fromEntries(writes.map((write) => [write.path, sha1(write.bytes)]))
	};
}
