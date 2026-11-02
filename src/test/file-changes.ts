// The file manager's actions as the remotes make them, each one change set through
// `applyFileChanges`, for tests that state a rule per action.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Actor } from '#lib/server/access.js';

import * as F from '#lib/server/files.js';

export const owner: Actor = { id: 1, role: 'owner' };

/** Writes a file's text over what it holds now, or makes it. */
export async function saveFile(actor: Actor, id: number, path: string, content: string) {
	const there = existsSync(join(F.resolveSafe(id, '').absolute, path));
	return F.applyFileChanges(actor, id, {
		writes: [
			there
				? { path, content, original: path, baseHash: F.readTextFile(id, path).hash }
				: { path, content }
		]
	});
}

export const saveFiles = (
	actor: Actor,
	id: number,
	list: { rel: string; content: string; baseHash: string }[]
) =>
	F.applyFileChanges(actor, id, {
		writes: list.map((f) => ({
			path: f.rel,
			content: f.content,
			original: f.rel,
			baseHash: f.baseHash
		}))
	});

export const addFile = async (actor: Actor, id: number, folder: string, name: string) =>
	F.applyFileChanges(actor, id, { writes: [{ path: F.entryPath(folder, name), content: '' }] });

export const moveEntry = async (actor: Actor, id: number, path: string, name: string) =>
	F.applyFileChanges(actor, id, { moves: [{ from: path, to: F.entryPath(dirname(path), name) }] });

export const removeEntry = (id: number, path: string, actor = owner) =>
	F.applyFileChanges(actor, id, { deletes: [path] });

export async function removeEntries(id: number, paths: string[], actor = owner) {
	const chosen = F.chosenPaths(paths);
	await F.applyFileChanges(actor, id, { deletes: chosen });
	return chosen.length;
}

export async function moveEntries(actor: Actor, id: number, paths: string[], folder: string) {
	const moves = F.movesInto(paths, folder);
	await F.applyFileChanges(actor, id, { moves });
	return moves.length;
}
