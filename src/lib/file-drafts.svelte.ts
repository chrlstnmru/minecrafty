// The drafts of the files opened in an editor: the instance file manager and a pack's config files
// share this. Each editor supplies how a file is read and how changes are saved.

import type { beforeNavigate } from '$app/navigation';

import { untrack } from 'svelte';

import { formatConfig } from '#lib/config-format.js';

/** What `beforeNavigate` hands its callback. */
export type Leaving = Parameters<Parameters<typeof beforeNavigate>[0]>[0];

/** A file as the server has it now. */
export type FileText = { content: string; hash: string };

/** A file being read: what the remote query for it gives. */
export type FileRead = PromiseLike<FileText> & {
	readonly current: FileText | undefined;
	readonly error: unknown;
	readonly loading: boolean;
	refresh(): Promise<void>;
};

/** An unsaved draft, as a save sends it. */
export type UnsavedDraft = { path: string; content: string; hash?: string; isNew: boolean };

export type Draft = {
	content: string;
	/** what the server had when it was read or last saved */
	loaded: string;
	/** what a save builds on */
	hash?: string;
	/** made in the editor and not saved yet */
	isNew: boolean;
	/** where the editor keeps this draft's text and undo history; it stays when the file moves */
	key: string;
};

export type DraftsAdapter = {
	/** Reads the file shown at `path`; null when there is nothing on the server to read. */
	read(path: string): FileRead | null;
	/**
	 * Saves these drafts (and whatever else the editor keeps waiting, limited to `only` when given).
	 * Returns the hash of each saved file and how many changes went out, or null when there was
	 * nothing to send. A refusal throws the remote's error, whose body names the path.
	 */
	save(
		drafts: UnsavedDraft[],
		only?: string[]
	): Promise<{ hashes: Record<string, string>; count: number } | null>;
	/** How many changes are waiting, drafts included; the unsaved drafts when not given. */
	count?(unsaved: UnsavedDraft[]): number;
	/** Where the file a refusal names shows now. */
	shownAt?(path: string): string;
	/** Takes away whatever else the editor keeps waiting, when everything is discarded. */
	onDiscardAll?(): void;
	/** A failure no caller waits for: re-reading or formatting a file. */
	report(message: string): void;
	/** The editor's texts; the default frees Monaco's models. */
	models?: { dispose(key: string): void; disposeAll(prefix: string): void };
};

export type SaveResult =
	| { saved: number }
	| { failed: { message: string; path?: string; stale: boolean } }
	| null;

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const rebase = (path: string, from: string, to: string) =>
	under(path, from) ? `${to}${path.slice(from.length)}` : path;

const errorBody = (e: unknown) => (e as { body?: App.Error } | null)?.body;
const messageOf = (e: unknown, fallback: string) => errorBody(e)?.message ?? fallback;

const monacoModels = {
	dispose: (key: string) =>
		void import('#lib/components/config-editor/monaco.js').then((m) => m.disposeModelsAt(key, '')),
	disposeAll: (prefix: string) =>
		void import('#lib/components/config-editor/monaco.js').then((m) => m.disposeModels(prefix))
};

// model keys stay unique across editors and remounts, so a disposal can never hit a newer draft
let nextKey = 0;

/**
 * Every file opened in an editor keeps its own draft, so switching file never loses an edit. Drafts
 * follow their file when it moves and go when it is deleted; the editor's undo history goes with
 * them. Create it while a component initialises: it loads the open file in an effect.
 */
export class FileDrafts {
	/** The drafts, by the path each file shows at. */
	byPath = $state<Record<string, Draft>>({});
	/** The file open in the editor. */
	open = $state<string | null>(null);
	saving = $state(false);
	saveError = $state<string>();
	/** The file a failed save names, by where it shows. */
	failedPath = $state<string>();
	/** What the discard dialog asks about; the dialog is open while this is set. */
	discarding = $state<{ paths: string[]; all?: boolean; then?: () => void } | null>(null);

	readonly #prefix: string;
	readonly #adapter: DraftsAdapter;
	readonly #models: NonNullable<DraftsAdapter['models']>;
	#editorShown = false;

	/** `prefix` keeps this editor's model keys apart from other editors'. */
	constructor(prefix: string, adapter: DraftsAdapter) {
		this.#prefix = `${prefix}/`;
		this.#adapter = adapter;
		this.#models = adapter.models ?? monacoModels;
		this.file = $derived(
			this.open && this.current && !this.current.isNew ? adapter.read(this.open) : null
		);
		this.changeCount = $derived(adapter.count ? adapter.count(this.unsaved) : this.unsaved.length);

		// load the file into the editor when it is opened, and again after a save
		$effect(() => {
			const current = this.file?.current;
			const path = this.open;
			if (!current || !path) return;
			untrack(() => {
				const draft = this.byPath[path];
				if (!draft) return;
				if (draft.content === draft.loaded) draft.content = current.content;
				draft.loaded = current.content;
				draft.hash = current.hash;
			});
		});

		$effect(() => {
			if (this.changeCount) return;
			untrack(() => {
				this.saveError = undefined;
				this.failedPath = undefined;
			});
		});
	}

	/** The draft of the open file. */
	readonly current = $derived(this.open ? this.byPath[this.open] : undefined);
	/** The open file being read from the server; null for a new file. */
	readonly file: FileRead | null;
	readonly unsaved: UnsavedDraft[] = $derived(
		Object.entries(this.byPath)
			.filter(([, draft]) => FileDrafts.isDirty(draft))
			.map(([path, draft]) => ({
				path,
				content: draft.content,
				hash: draft.hash,
				isNew: draft.isNew
			}))
	);
	readonly unsavedPaths = $derived(this.unsaved.map((draft) => draft.path));
	/** Every change waiting, drafts and whatever else the editor keeps. */
	readonly changeCount: number;

	/** New, or edited since it was read or saved. */
	static isDirty(draft: Draft) {
		return draft.isNew || draft.content !== draft.loaded;
	}

	/** Whether the file at `path` has an unsaved draft. */
	dirty(path: string) {
		const draft = this.byPath[path];
		return draft ? FileDrafts.isDirty(draft) : false;
	}

	/** The key the editor keeps this file's text and undo history under. */
	modelKey(path: string) {
		const draft = this.byPath[path];
		return draft ? `${this.#prefix}${draft.key}` : undefined;
	}

	/** Opens `path` in the editor; `created` makes a new, empty file that exists once saved. */
	show(path: string | null, { created = false } = {}) {
		this.open = path;
		if (!path) return;
		this.#editorShown = true;
		this.byPath[path] ??= { content: '', loaded: '', isNew: created, key: String(nextKey++) };
	}

	/** Moves the drafts of a file, or of everything in a folder, to where it went. */
	rekey(from: string, to: string) {
		if (from === to) return;
		const moved = Object.keys(this.byPath).filter((path) => under(path, from));
		const drafts = moved.map((path) => this.byPath[path]);
		for (const path of moved) delete this.byPath[path];
		moved.forEach((path, index) => (this.byPath[rebase(path, from, to)] = drafts[index]));
		if (this.open && under(this.open, from)) this.open = rebase(this.open, from, to);
		if (this.failedPath && under(this.failedPath, from))
			this.failedPath = rebase(this.failedPath, from, to);
	}

	/** Drops the drafts of a file, or of everything in a folder; closes the editor if it was on one. */
	drop(path: string) {
		for (const key of Object.keys(this.byPath)) if (under(key, path)) this.#forget(key);
		if (this.open && under(this.open, path)) this.open = null;
	}

	/** Puts a file back to its saved text (undo brings the edits back); a new file is dropped. */
	revert(path: string) {
		const draft = this.byPath[path];
		if (!draft) return;
		if (draft.isNew) {
			this.#forget(path);
			if (this.open === path) this.open = null;
			return;
		}
		draft.content = draft.loaded;
		// a save refused this file as out of date, so what it was read as is stale too
		if (path === this.failedPath) void this.refetch(path);
	}

	/** Reads a file again, as the server has it now, replacing its draft. */
	async refetch(path: string) {
		const read = this.#adapter.read(path);
		if (!read) return;
		try {
			await read.refresh();
			const fresh = await read;
			const draft = this.byPath[path];
			if (draft) {
				draft.content = draft.loaded = fresh.content;
				draft.hash = fresh.hash;
			}
			if (this.failedPath === path) {
				this.failedPath = undefined;
				this.saveError = undefined;
			}
		} catch (e) {
			this.#adapter.report(messageOf(e, 'Could not read the file again'));
		}
	}

	/** Tidies the open file's text. */
	async format() {
		const path = this.open;
		const draft = this.current;
		if (!path || !draft) return;
		try {
			draft.content = await formatConfig(path, draft.content);
		} catch (e) {
			this.#adapter.report(e instanceof Error ? e.message : 'Could not format this file');
		}
	}

	/**
	 * Saves the unsaved drafts together (only those at `paths` when given); one refused stops them
	 * all. Edits made while the save is going out stay unsaved.
	 */
	async saveAll(paths?: string[]): Promise<SaveResult> {
		if (this.saving) return null;
		const sent = this.unsaved.filter(
			(draft) => (!paths || paths.includes(draft.path)) && (draft.isNew || draft.hash)
		);
		this.saving = true;
		this.saveError = undefined;
		this.failedPath = undefined;
		try {
			const result = await this.#adapter.save(sent, paths);
			if (!result) return null;
			for (const { path, content } of sent) {
				const draft = this.byPath[path];
				if (!draft) continue;
				draft.loaded = content;
				draft.hash = result.hashes[path];
				draft.isNew = false;
			}
			return { saved: result.count };
		} catch (e) {
			const message = messageOf(e, 'Could not save the changes');
			const named = errorBody(e)?.path;
			const path = named ? (this.#adapter.shownAt?.(named) ?? named) : undefined;
			this.saveError = message;
			this.failedPath = path;
			return { failed: { message, path, stale: !!path && errorBody(e)?.reason === 'stale' } };
		} finally {
			this.saving = false;
		}
	}

	/** Asks before throwing away the drafts at `paths`; `then` runs once they are gone. */
	askDiscard(paths: string[], then?: () => void) {
		this.discarding = { paths, then };
	}

	/** Asks before throwing away every draft and whatever else the editor keeps waiting. */
	askDiscardAll(then?: () => void) {
		this.discarding = { paths: this.unsavedPaths, all: true, then };
	}

	/** The dialog's Discard: closes the question first, so nothing the action does can leave it open. */
	discard() {
		const asked = this.discarding;
		this.discarding = null;
		if (!asked) return;
		if (asked.all) {
			this.#adapter.onDiscardAll?.();
			for (const path of Object.keys(this.byPath)) this.revert(path);
			this.failedPath = undefined;
			this.saveError = undefined;
		} else for (const path of asked.paths) this.revert(path);
		asked.then?.();
	}

	/**
	 * For `beforeNavigate`: leaving the page with changes waiting asks first, then goes on with
	 * `go`. Closing or reloading the tab is left to the browser's own question.
	 */
	leave(navigation: Leaving, go: (url: URL) => void) {
		// changing only the query keeps the page, and the drafts with it
		if (navigation.to?.url.pathname === navigation.from?.url.pathname) return;
		if (!this.changeCount) return;
		navigation.cancel();
		if (navigation.type === 'leave' || !navigation.to) return;
		const { url } = navigation.to;
		this.askDiscardAll(() => go(url));
	}

	/** Frees every text the editor kept; call when the page goes. */
	destroy() {
		if (this.#editorShown) this.#models.disposeAll(this.#prefix);
	}

	#forget(path: string) {
		const draft = this.byPath[path];
		if (!draft) return;
		delete this.byPath[path];
		if (this.#editorShown) this.#models.dispose(`${this.#prefix}${draft.key}`);
	}
}
