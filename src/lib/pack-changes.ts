// The changes waiting to be saved in a pack's Configs tab, other than the text of an open file:
// moves and deletes. They are kept per file (a folder is its files) under the path each file has on
// the server, and the tree shows the result as if they were done. Pure, so it can be tested.

export type ServerFile = { path: string; size: number };

/** By the path a file has on the server: where it goes, or null when it is to be deleted. */
export type Staged = Record<string, string | null>;

export type ViewFile = {
	/** where the file shows: its new place when it is moved, its own place when it is to be deleted */
	path: string;
	size: number;
	/** where the file is on the server now */
	original: string;
	deleted: boolean;
	moved: boolean;
};

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const rebase = (path: string, from: string, to: string) =>
	under(path, from) ? `${to}${path.slice(from.length)}` : path;

/** The files as the tree shows them with the staged changes applied. */
export function viewOf(files: ServerFile[], staged: Staged): ViewFile[] {
	return files.map((file) => {
		const to = staged[file.path];
		if (to === undefined)
			return {
				path: file.path,
				size: file.size,
				original: file.path,
				deleted: false,
				moved: false
			};
		if (to === null)
			return { path: file.path, size: file.size, original: file.path, deleted: true, moved: false };
		return { path: to, size: file.size, original: file.path, deleted: false, moved: true };
	});
}

/** Where the file that shows at `path` is on the server, or undefined when none does (a new file). */
export const originalOf = (view: ViewFile[], path: string) =>
	view.find((file) => !file.deleted && file.path === path)?.original;

/**
 * Stages moving a file or a folder (by the path it shows at) to `to`, which is the new path of the
 * item itself. A name that is taken, or would clash with a file or folder, refuses the move, and a
 * file waiting to be deleted still holds its name. Moving a file back to where it is on the server
 * takes the change away.
 */
export function stageMove(
	view: ViewFile[],
	staged: Staged,
	from: string,
	to: string
): { staged: Staged } | { error: string } {
	if (from === to) return { staged };
	if (under(to, from)) return { error: `${from} cannot be moved into itself` };
	const items = view.filter((file) => !file.deleted && under(file.path, from));
	if (!items.length) return { error: `${from} not found` };

	const moving = new Set(items.map((item) => item.path));
	const next = { ...staged };
	for (const item of items) {
		const target = rebase(item.path, from, to);
		const taken = view.find((file) => !moving.has(file.path) && file.path === target);
		if (taken) return { error: `${target} already exists` };
		const folder = view.find(
			(file) => !moving.has(file.path) && file.path.startsWith(`${target}/`)
		);
		if (folder) return { error: `${target} is a folder` };
		const parent = view.find(
			(file) => !moving.has(file.path) && target.startsWith(`${file.path}/`)
		);
		if (parent) return { error: `${parent.path} is a file` };
		if (target === item.original) delete next[item.original];
		else next[item.original] = target;
	}
	return { staged: next };
}

/** Stages deleting a file, or every file in a folder. */
export function stageDelete(view: ViewFile[], staged: Staged, path: string): Staged {
	const next = { ...staged };
	for (const file of view) if (!file.deleted && under(file.path, path)) next[file.original] = null;
	return next;
}

/** Takes one staged change away, by the path the file has on the server. */
export function undoStaged(staged: Staged, original: string): Staged {
	const { [original]: _removed, ...rest } = staged;
	return rest;
}

export type DraftToSave = { path: string; content: string; hash?: string; isNew: boolean };

export type Changes = {
	moves: { from: string; to: string }[];
	deletes: string[];
	writes: { path: string; content: string; original?: string; baseHash?: string }[];
};

/**
 * Everything to send to save the staged changes together. `drafts` are the texts that changed
 * (by the path they show at); an existing file says where it is on the server and the hash of the
 * text it was opened as, and a file made here says neither.
 */
export function changesOf(view: ViewFile[], staged: Staged, drafts: DraftToSave[]): Changes {
	const entries = Object.entries(staged);
	return {
		moves: entries.flatMap(([from, to]) => (to === null ? [] : [{ from, to }])),
		deletes: entries.flatMap(([path, to]) => (to === null ? [path] : [])),
		writes: drafts.flatMap((draft) => {
			if (draft.isNew) return [{ path: draft.path, content: draft.content }];
			const original = originalOf(view, draft.path);
			return original !== undefined && draft.hash
				? [{ path: draft.path, content: draft.content, original, baseHash: draft.hash }]
				: [];
		})
	};
}

/**
 * How many files have something waiting: edited, new, moved or deleted, a file counted once however
 * many of those apply to it.
 */
export function countChanges(view: ViewFile[], staged: Staged, drafts: DraftToSave[]) {
	const touched = new Set(Object.keys(staged).map((original) => `server:${original}`));
	for (const draft of drafts) {
		const original = draft.isNew ? undefined : originalOf(view, draft.path);
		touched.add(original === undefined ? `new:${draft.path}` : `server:${original}`);
	}
	return touched.size;
}
