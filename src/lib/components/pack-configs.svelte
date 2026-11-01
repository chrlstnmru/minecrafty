<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowBackUpIcon from '@tabler/icons-svelte/icons/arrow-back-up';
	import ArrowsMoveIcon from '@tabler/icons-svelte/icons/arrows-move';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import FilePlusIcon from '@tabler/icons-svelte/icons/file-plus';
	import FileSearchIcon from '@tabler/icons-svelte/icons/file-search';
	import FolderPlusIcon from '@tabler/icons-svelte/icons/folder-plus';
	import FolderUpIcon from '@tabler/icons-svelte/icons/folder-up';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import WandIcon from '@tabler/icons-svelte/icons/wand';
	import { onDestroy, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { getLocalPack, readPackConfig, savePackChanges } from '#lib/builder.remote.js';
	import CodeEditor from '#lib/components/config-editor/code-editor.svelte';
	import FileTree from '#lib/components/file-tree.svelte';
	import SaveBar from '#lib/components/save-bar.svelte';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import SelectionBar from '#lib/components/selection-bar.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { formatConfig, formatKind } from '#lib/config-format.js';
	import { isEditable } from '#lib/editable.js';
	import {
		buildFileTree,
		canMoveInto,
		decodeDrag,
		TREE_DRAG_TYPE,
		topLevelPaths
	} from '#lib/file-tree.js';
	import { formatBytes } from '#lib/format.js';
	import {
		changesOf,
		countChanges,
		originalOf,
		stageDelete,
		stageMove,
		undoStaged,
		viewOf,
		type Staged
	} from '#lib/pack-changes.js';
	import {
		batches,
		collectEntries,
		fromFileList,
		MAX_ITEMS,
		type FsEntry,
		type UploadItem
	} from '#lib/upload-entries.js';
	import { cn } from '#lib/utils.js';

	let {
		id,
		files,
		canWrite,
		class: className
	}: {
		id: number;
		files: { path: string; size: number }[];
		canWrite: boolean;
		class?: string;
	} = $props();

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
	const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
	const joinPath = (dir: string, rel: string) => (dir ? `${dir}/${rel}` : rel);
	const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

	/** `path` as it reads once the folder `from` has been renamed to `to`. */
	const rebase = (path: string, from: string, to: string) =>
		under(path, from) ? `${to}${path.slice(from.length)}` : path;

	// Every file opened here keeps its own text, so switching file never loses an edit. `loaded` is
	// what the server had when it was read (or last saved), `hash` is what a save builds on, and a
	// file made here is `isNew` until its first save.
	type Draft = { content: string; loaded: string; hash?: string; isNew: boolean };
	let open = $state<string | null>(null);
	let drafts = $state<Record<string, Draft>>({});
	const entry = $derived(open ? drafts[open] : undefined);
	const isDirty = (d: Draft) => d.isNew || d.content !== d.loaded;
	const unsavedPaths = $derived(
		Object.entries(drafts)
			.filter(([, d]) => isDirty(d))
			.map(([path]) => path)
	);
	let editorShown = false;

	// Moves and deletes wait here, by where each file is on the server now, until Save all. The tree
	// shows the result as if it were done.
	let staged = $state<Staged>({});
	const view = $derived(viewOf(files, staged));

	type Item = {
		path: string;
		size: number;
		pending?: boolean;
		deleted?: boolean;
		moved?: boolean;
		original?: string;
	};
	// the new files show in the tree before the server has them
	const listed: Item[] = $derived([
		...view.map((f) => ({ ...f })),
		...Object.entries(drafts)
			.filter(([path, d]) => d.isNew && !view.some((f) => f.path === path))
			.map(([path]) => ({ path, size: 0, pending: true }))
	]);
	// what is waiting to be saved: edited and new files, moves and deletes
	const draftList = $derived(
		unsavedPaths.map((path) => ({
			path,
			content: drafts[path].content,
			hash: drafts[path].hash,
			isNew: drafts[path].isNew
		}))
	);
	const changeCount = $derived(countChanges(view, staged, draftList));

	// folders that are new here or lost their last file: the pack cannot keep an empty folder, so the
	// server has no trace of them, but they stay in the tree until the page is reloaded or they are deleted
	let emptyFolders = $state<string[]>([]);
	const tree = $derived(buildFileTree(listed, emptyFolders));

	// where New file, New folder and Upload put things: the last folder or file picked, else the root
	let targetDir = $state('');
	const folderPaths = $derived(
		new Set(
			[...listed.map((f) => dirOf(f.path)), ...emptyFolders].flatMap((path) => {
				const parts = path ? path.split('/') : [];
				return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
			})
		)
	);
	const target = $derived(folderPaths.has(targetDir) ? targetDir : '');
	const where = $derived(target || 'overrides');

	// the open file is read from where it is on the server, even when a move is waiting for it
	const openOriginal = $derived(open ? originalOf(view, open) : undefined);
	const file = $derived(
		open && entry && !entry.isNew && openOriginal
			? readPackConfig({ id, path: openOriginal })
			: null
	);
	const dirty = $derived(entry ? entry.content !== entry.loaded : false);
	const unsaved = $derived(entry ? isDirty(entry) : false);

	// load the file into the editor when it is opened, and again after a save
	$effect(() => {
		const current = file?.current;
		const path = open;
		if (!current || !path) return;
		untrack(() => {
			const draft = drafts[path];
			if (!draft) return;
			if (draft.content === draft.loaded) draft.content = current.content;
			draft.loaded = current.content;
			draft.hash = current.hash;
		});
	});

	function show(path: string | null, created = false) {
		open = path;
		if (!path) return;
		editorShown = true;
		drafts[path] ??= { content: '', loaded: '', isNew: created };
	}

	// the editor keeps each file's text and undo history; free them when the panel goes
	onDestroy(() => {
		if (editorShown)
			void import('./config-editor/monaco.js').then((editor) => editor.disposeModels(`${id}/`));
	});

	/** Puts a file back to its saved text; a file made here is dropped. */
	function revert(path: string) {
		const draft = drafts[path];
		if (!draft) return;
		if (draft.isNew) {
			delete drafts[path];
			if (open === path) open = null;
		} else {
			draft.content = draft.loaded;
			// a save refused this file as out of date, so what it was read as is stale too
			if (path === failedPath) void refetch(path);
		}
	}

	/** Takes everything waiting away: edits, new files, moves and deletes. */
	function undoAll() {
		for (const item of view) if (item.moved) rekeyDrafts(item.path, item.original);
		staged = {};
		for (const path of Object.keys(drafts)) revert(path);
		failedPath = undefined;
		saveError = undefined;
	}

	let discarding = $state<{ paths: string[]; all?: boolean; then?: () => void } | null>(null);
	let discardOpen = $state(false);

	function askDiscard(paths: string[], then?: () => void) {
		discarding = { paths, then };
		discardOpen = true;
	}

	function askDiscardAll(then?: () => void) {
		discarding = { paths: unsavedPaths, all: true, then };
		discardOpen = true;
	}

	/** The dialog's Discard: close it first, so nothing the action does can leave it open. */
	function discard() {
		discardOpen = false;
		const asked = discarding;
		discarding = null;
		if (!asked) return;
		if (asked.all) undoAll();
		else for (const path of asked.paths) revert(path);
		asked.then?.();
	}

	/** The Discard button: an edit goes back to the saved text (undo brings it back), a new file is asked about. */
	function discardEdits() {
		if (!open || !entry) return;
		if (entry.isNew) askDiscard([open]);
		else revert(open);
	}

	// SvelteKit also runs this when the tab is closed or reloaded, where cancel() asks the browser
	beforeNavigate((navigation) => {
		// changing the tab only changes the query; this panel stays mounted, so nothing is lost
		if (navigation.to?.url.pathname === page.url.pathname) return;
		if (!changeCount) return;
		navigation.cancel();
		if (navigation.type === 'leave' || !navigation.to) return;
		const { url } = navigation.to;
		askDiscardAll(() => void goto(url));
	});

	let saving = $state(false);
	let saveError = $state<string>();
	// the file a failed save names, marked in the tree
	let failedPath = $state<string>();

	$effect(() => {
		if (changeCount) return;
		saveError = undefined;
		failedPath = undefined;
	});

	/**
	 * Saves what is waiting together, as one revision; one part refused stops it all. `only` limits
	 * it to the edits of those files (shown at those paths) and the moves that belong to them.
	 */
	async function saveAll(only?: string[]) {
		if (!canWrite || saving) return;
		const sentDrafts = draftList.filter((d) => !only || only.includes(d.path));
		const originals = new Set(
			(only ?? []).flatMap((path) => {
				const original = originalOf(view, path);
				return original === undefined ? [] : [original];
			})
		);
		const sentStaged: Staged = only
			? Object.fromEntries(Object.entries(staged).filter(([original]) => originals.has(original)))
			: staged;
		const changes = changesOf(view, sentStaged, sentDrafts);
		if (!changes.moves.length && !changes.deletes.length && !changes.writes.length) return;
		const count = countChanges(view, sentStaged, sentDrafts);
		saving = true;
		saveError = undefined;
		failedPath = undefined;
		try {
			const { hashes } = await savePackChanges({ id, ...changes });
			for (const sent of sentDrafts) {
				const draft = drafts[sent.path];
				if (!draft) continue;
				// edits made while the save was going out stay unsaved
				draft.loaded = sent.content;
				draft.hash = hashes[sent.path];
				draft.isNew = false;
			}
			staged = Object.fromEntries(
				Object.entries(staged).filter(([original]) => !(original in sentStaged))
			);
			toast.success(count === 1 ? 'Saved' : `Saved ${count} changes`);
		} catch (e) {
			const text = message(e, 'Could not save the changes');
			saveError = text;
			// the message starts with the path it is about, as the server knows it
			const named = [
				...changes.moves.flatMap((m) => [m.from, m.to]),
				...changes.deletes,
				...changes.writes.flatMap((w) => [w.path, w.original ?? ''])
			].find((path) => path && text.startsWith(`${path}: `));
			failedPath = named
				? (view.find((f) => f.original === named || f.path === named)?.path ?? named)
				: undefined;
			const stale = failedPath && text.includes('changed since you opened it');
			if (stale) {
				const path = failedPath!;
				toast.error(text, {
					action: { label: 'Reload', onClick: () => askDiscard([path], () => void refetch(path)) }
				});
			} else toast.error(text);
		} finally {
			saving = false;
		}
	}

	const save = () => (open ? saveAll([open]) : undefined);

	/** Reads a file again, as the server has it now, replacing what was in the editor. */
	async function refetch(path: string) {
		const original = originalOf(view, path) ?? path;
		try {
			await readPackConfig({ id, path: original }).refresh();
			const fresh = await readPackConfig({ id, path: original });
			const draft = drafts[path];
			if (draft) {
				draft.content = draft.loaded = fresh.content;
				draft.hash = fresh.hash;
			}
			if (failedPath === path) {
				failedPath = undefined;
				saveError = undefined;
			}
		} catch (e) {
			toast.error(message(e, 'Could not read the file again'));
		}
	}

	async function format() {
		if (!open || !entry) return;
		try {
			entry.content = await formatConfig(open, entry.content);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not format this file');
		}
	}

	/** A folder that lost its last file stays in the tree, empty, rather than vanishing under the cursor. */
	function keepFolder(dir: string) {
		if (dir && !emptyFolders.includes(dir)) emptyFolders = [...emptyFolders, dir];
	}

	/** Drops the texts held for a file, or for everything in a folder; closes the editor if it was on one. */
	function dropDrafts(path: string) {
		for (const key of Object.keys(drafts)) if (under(key, path)) delete drafts[key];
		if (open && under(open, path)) open = null;
	}

	/** Moves the texts held for a file, or for everything in a folder, to where it went. */
	function rekeyDrafts(from: string, to: string) {
		for (const key of Object.keys(drafts)) {
			if (!under(key, from)) continue;
			drafts[rebase(key, from, to)] = drafts[key];
			delete drafts[key];
		}
		if (open && under(open, from)) open = rebase(open, from, to);
	}

	/** Forgets what the page held for a folder that goes: its empty-folder marks, the target and the texts. */
	function forgetFolder(path: string) {
		emptyFolders = emptyFolders.filter((folder) => !under(folder, path));
		if (under(targetDir, path)) targetDir = dirOf(path);
		dropDrafts(path);
	}

	/** Stages deleting files and folders (by where they show): they stay in the tree, struck through, until saved. */
	function deletePaths(paths: string[]) {
		let next = staged;
		for (const path of paths) {
			const current = viewOf(files, next);
			if (current.some((f) => !f.deleted && under(f.path, path))) keepFolder(dirOf(path));
			next = stageDelete(current, next, path);
			forgetFolder(path);
		}
		staged = next;
	}

	/**
	 * Stages moving files and folders (by where they show), all or none: a name that is taken or a
	 * folder going into itself refuses the lot. What is only here (a new file, an empty folder) just
	 * changes its path.
	 */
	function movePaths(moves: { from: string; to: string }[]) {
		let next = staged;
		const onServer: string[] = [];
		for (const { from, to } of moves) {
			const current = viewOf(files, next);
			const here = current.some((f) => !f.deleted && under(f.path, from));
			const heldHere =
				Object.keys(drafts).some((path) => under(path, from)) ||
				emptyFolders.some((folder) => under(folder, from));
			if (!here && !heldHere) {
				toast.error(`${from} not found`);
				return false;
			}
			const taken = Object.entries(drafts).find(
				([path, d]) =>
					d.isNew &&
					under(path, from) &&
					current.some((f) => f.path === rebase(path, from, to) && !under(f.path, from))
			);
			if (taken) {
				toast.error(`${rebase(taken[0], from, to)} already exists`);
				return false;
			}
			if (!here) continue;
			const result = stageMove(current, next, from, to);
			if ('error' in result) {
				toast.error(result.error);
				return false;
			}
			next = result.staged;
			onServer.push(from);
		}
		staged = next;
		for (const { from, to } of moves) {
			if (onServer.includes(from)) keepFolder(dirOf(from));
			emptyFolders = emptyFolders.map((folder) => rebase(folder, from, to));
			targetDir = rebase(targetDir, from, to);
			rekeyDrafts(from, to);
		}
		return true;
	}

	/** Takes one staged move or delete away, by where the file is on the server. */
	function undoChange(original: string | undefined) {
		const item = view.find((f) => f.original === original);
		if (!original || !item) return;
		if (item.moved) {
			if (listed.some((f) => f.path === original)) {
				toast.error(`${original} is taken now`);
				return;
			}
			rekeyDrafts(item.path, original);
		}
		staged = undoStaged(staged, original);
	}

	/** A drop on a folder: each dragged file or folder keeps its name and goes into it. */
	function moveInto(from: string[], folder: string) {
		if (!canMoveInto(from, folder)) return;
		const moves = from
			.map((path) => ({ from: path, to: joinPath(folder, nameOf(path)) }))
			.filter((move) => move.from !== move.to);
		if (movePaths(moves) && from.length > 1) selection = new Set();
	}

	// a new file or folder is named inside `dir` (the folder picked when it was asked for); a rename takes a whole path
	let naming = $state<{
		kind: 'file' | 'folder';
		from?: string;
		dir: string;
		value: string;
	} | null>(null);
	let namingOpen = $state(false);

	const namedPath = $derived(
		naming
			? naming.from
				? naming.value.trim().replace(/\/+$/, '')
				: joinPath(naming.dir, naming.value.trim())
			: ''
	);

	const nameError = $derived.by(() => {
		if (!naming) return undefined;
		const name = naming.value.trim();
		if (!name)
			return naming.from
				? `Enter a path, such as ${naming.kind === 'folder' ? 'config/sodium' : 'config/mod.toml'}`
				: naming.kind === 'folder'
					? 'Enter a folder name, such as sodium'
					: 'Enter a file name, such as mod.toml';
		if (!naming.from && (/[\\/]/.test(name) || name === '.' || name === '..'))
			return 'Use a name without slashes. Pick the folder first to choose where it goes.';
		const path = namedPath;
		if (path.startsWith('/') || path.split('/').includes('..'))
			return 'Use a path inside the server folder, without a leading slash or ..';
		if (path === naming.from) return undefined;
		if (naming.kind === 'folder' && naming.from && path.startsWith(`${naming.from}/`))
			return 'A folder cannot be moved into itself';
		const asFile = listed.find((f) => f.path === path || path.startsWith(`${f.path}/`));
		if (asFile) return `${asFile.path} is a file`;
		if (naming.kind === 'folder') {
			if (folderPaths.has(path)) return `${path} already exists`;
		} else {
			if (folderPaths.has(path)) return `${path} is a folder`;
			if (!naming.from && !isEditable(nameOf(path)))
				return 'Only text files can be made here: .toml, .json, .yml, .properties, .cfg, .xml, .md and similar';
		}
		return undefined;
	});

	// an empty field only keeps Create disabled; a mistake is shown once something is typed
	const shownError = $derived(naming?.value.trim() ? nameError : undefined);

	const nameHint = $derived(
		naming?.from
			? `The path inside the server folder, such as ${naming.kind === 'folder' ? 'config/sodium' : 'config/mod.toml'}.`
			: naming?.kind === 'folder'
				? 'A folder name such as sodium. It cannot contain slashes.'
				: 'A text file such as mod.toml, options.json or config.yml.'
	);

	function startNaming(kind: 'file' | 'folder', from?: string) {
		naming = { kind, from, dir: target, value: from ?? '' };
		namingOpen = true;
	}

	function confirmName() {
		if (!naming || nameError) return;
		const { kind, from } = naming;
		const to = namedPath;
		namingOpen = false;
		if (from) {
			movePaths([{ from, to }]);
			return;
		}
		if (kind === 'folder') {
			emptyFolders = [...emptyFolders, to];
			targetDir = to;
			return;
		}
		targetDir = dirOf(to);
		show(to, true);
	}

	// Rows chosen with the checkboxes. A deleted file, and a folder that holds nothing, get no checkbox.
	let selection = $state<ReadonlySet<string>>(new Set());
	const choosable = (path: string) => listed.some((f) => !f.deleted && under(f.path, path));

	$effect(() => {
		const kept = [...selection].filter(choosable);
		if (kept.length !== selection.size) selection = new Set(kept);
	});

	const chosen = $derived(topLevelPaths(selection));
	const chosenItems = $derived(
		listed.filter((f) => !f.deleted && chosen.some((path) => under(f.path, path)))
	);
	/** What these paths are, such as "1 folder and 2 files". */
	function labelOf(paths: string[]) {
		const folders = paths.filter((path) => !listed.some((f) => f.path === path)).length;
		const loose = paths.length - folders;
		return [
			folders ? `${folders} ${folders === 1 ? 'folder' : 'folders'}` : '',
			loose ? `${loose} ${loose === 1 ? 'file' : 'files'}` : ''
		]
			.filter(Boolean)
			.join(' and ');
	}
	const chosenLabel = $derived(labelOf(chosen));
	// the zip is made from what is on the server, so a file that is new or waiting to move is not in it yet
	const canDownload = $derived(chosenItems.every((f) => !f.pending && !f.moved));

	let bulkMoveOpen = $state(false);
	let moveTo = $state('');
	const moveOptions = $derived([
		{ value: '', label: 'overrides (the server folder)' },
		...[...folderPaths]
			.filter((folder) => !chosen.some((path) => under(folder, path)))
			.sort((a, b) => a.localeCompare(b))
			.map((folder) => ({ value: folder, label: folder }))
	]);

	function bulkDelete() {
		const label = chosenLabel;
		deletePaths(chosen);
		selection = new Set();
		toast(`${label} will be deleted when you save`);
	}

	function bulkMove() {
		bulkMoveOpen = false;
		const moves = chosen
			.map((path) => ({ from: path, to: joinPath(moveTo, nameOf(path)) }))
			.filter((move) => move.from !== move.to);
		if (movePaths(moves)) selection = new Set();
	}

	let downloading = $state(false);

	async function download() {
		downloading = true;
		try {
			const body = new FormData();
			for (const path of chosen) body.append('path', path);
			const res = await fetch(`/modpacks/${id}/overrides/download`, { method: 'POST', body });
			if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
			const name = /filename\*=UTF-8''([^;]+)/.exec(
				res.headers.get('Content-Disposition') ?? ''
			)?.[1];
			const link = document.createElement('a');
			link.href = URL.createObjectURL(await res.blob());
			link.download = name ? decodeURIComponent(name) : 'config-files.zip';
			link.click();
			setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
		} catch (e) {
			toast.error(e instanceof Error && e.message ? e.message : 'Could not make the zip');
		} finally {
			downloading = false;
		}
	}

	let uploading = $state(false);
	let dragging = $state(false);
	let rootDrop = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let folderInput = $state<HTMLInputElement>();

	async function upload(items: UploadItem[], dir: string) {
		if (!items.length) return;
		if (items.length > MAX_ITEMS) {
			toast.error(`That is too many files: add at most ${MAX_ITEMS} at a time`);
			return;
		}
		uploading = true;
		let added = 0;
		try {
			for (const batch of batches(items)) {
				const body = new FormData();
				for (const { file, path } of batch) {
					body.append('file', file);
					body.append('path', joinPath(dir, path));
				}
				const res = await fetch(`/modpacks/${id}/overrides`, { method: 'POST', body });
				if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
				added += batch.length;
			}
			toast.success(added === 1 ? `Added ${items[0].file.name}` : `Added ${added} files`);
		} catch (e) {
			const reason = e instanceof Error && e.message ? e.message : 'Could not add the files';
			toast.error(added ? `${reason} (${added} of ${items.length} files were added)` : reason);
		} finally {
			await getLocalPack({ id }).refresh();
			uploading = false;
		}
	}

	async function drop(transfer: DataTransfer, dir: string) {
		// the entries must be taken now: the list is emptied once the event handler returns
		const entries = Array.from(transfer.items)
			.map((item) => item.webkitGetAsEntry?.())
			.filter((entry): entry is FileSystemEntry => !!entry);
		try {
			await upload(
				entries.length
					? await collectEntries(entries as unknown as FsEntry[])
					: fromFileList(transfer.files),
				dir
			);
		} catch {
			toast.error('Could not read what was dropped');
		}
	}

	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
</script>

{#snippet tool(label: string, Icon: typeof FilePlusIcon, run: () => void, busy = false)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					aria-label={label}
					loading={busy}
					onclick={run}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{label}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<Card.Root class={className}>
	<Card.Header>
		<Card.Title>Config files</Card.Title>
		<Card.Description>
			Copied into every server made from this pack, and into the .mrpack under overrides/.
		</Card.Description>
	</Card.Header>
	<Card.Content
		class="grid min-h-0 flex-1 gap-4 max-md:overflow-y-auto md:grid-cols-[24rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
	>
		<div
			role="group"
			aria-label="Config files"
			class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border max-md:min-h-64 {dragging
				? 'bg-accent/30 ring-2 ring-ring/50'
				: ''}"
			ondragover={(event) => {
				if (!canWrite || !hasFiles(event)) return;
				event.preventDefault();
				dragging = true;
			}}
			ondragleave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) dragging = false;
			}}
			ondrop={(event) => {
				dragging = false;
				if (!canWrite || !event.dataTransfer || !hasFiles(event)) return;
				event.preventDefault();
				void drop(event.dataTransfer, '');
			}}
		>
			<div class="flex items-center gap-1 border-b bg-muted/50 py-1.5 ps-3 pe-2">
				<button
					type="button"
					class="min-w-0 flex-1 truncate rounded-sm text-start font-mono text-xs {target === ''
						? 'text-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					aria-pressed={target === ''}
					onclick={() => (targetDir = '')}
				>
					overrides
				</button>
				{#if canWrite}
					<div class="flex shrink-0 items-center gap-0.5">
						{@render tool(`New file in ${where}`, FilePlusIcon, () => startNaming('file'))}
						{@render tool(`New folder in ${where}`, FolderPlusIcon, () => startNaming('folder'))}
						{@render tool(
							`Upload files to ${where}`,
							UploadIcon,
							() => fileInput?.click(),
							uploading
						)}
						{@render tool(
							`Upload a folder to ${where}`,
							FolderUpIcon,
							() => folderInput?.click(),
							uploading
						)}
					</div>
				{/if}
			</div>
			{#if canWrite}
				<input
					bind:this={fileInput}
					type="file"
					multiple
					class="hidden"
					onchange={(e) => {
						void upload(fromFileList(e.currentTarget.files ?? []), target);
						e.currentTarget.value = '';
					}}
				/>
				<input
					bind:this={folderInput}
					type="file"
					webkitdirectory
					multiple
					class="hidden"
					onchange={(e) => {
						void upload(fromFileList(e.currentTarget.files ?? []), target);
						e.currentTarget.value = '';
					}}
				/>
			{/if}
			<!-- clicking anywhere in the tree but on a row goes back to the server folder; the overrides button is the keyboard way -->
			<div
				role="presentation"
				class="min-h-0 flex-1 overflow-y-auto p-2 {rootDrop ? 'bg-accent/30' : ''}"
				onclick={(event) => {
					if (!(event.target as Element).closest('[data-tree-row]')) targetDir = '';
				}}
				ondragover={(event) => {
					if (!canWrite || !event.dataTransfer?.types.includes(TREE_DRAG_TYPE)) return;
					event.preventDefault();
					rootDrop = true;
				}}
				ondragleave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node)) rootDrop = false;
				}}
				ondragend={() => (rootDrop = false)}
				ondrop={(event) => {
					rootDrop = false;
					const from = decodeDrag(event.dataTransfer?.getData(TREE_DRAG_TYPE));
					if (!canWrite || !from.length) return;
					event.preventDefault();
					moveInto(from, '');
				}}
			>
				{#if tree.length}
					<FileTree
						nodes={tree}
						selected={open}
						selectedFolder={target || null}
						selectable={(file) => !file.deleted && isEditable(file.path)}
						unselectableTitle={(file) =>
							file.deleted ? 'Deleted when you save' : 'Not a text file'}
						nameClass={(file) => (file.deleted ? 'line-through' : undefined)}
						dragDisabled={(file) => !!file.deleted}
						status={(file) =>
							file.pending
								? { tone: 'info', label: 'New file, not saved yet' }
								: file.path === failedPath
									? { tone: 'danger', label: 'Stopped the save' }
									: file.deleted
										? { tone: 'danger', label: 'Deleted when you save' }
										: drafts[file.path] && isDirty(drafts[file.path])
											? { tone: 'warning', label: 'Unsaved changes' }
											: file.moved
												? { tone: 'info', label: `Moved from ${file.original} when you save` }
												: undefined}
						folderStatus={(folder) =>
							emptyFolders.includes(folder.path) && !listed.some((f) => under(f.path, folder.path))
								? { tone: 'info', label: 'Empty folder, not kept in the pack' }
								: undefined}
						onselect={(file) => {
							targetDir = dirOf(file.path);
							show(file.path);
						}}
						{selection}
						onselection={(next) => (selection = next)}
						checkable={choosable}
						onselectfolder={(path) => (targetDir = path)}
						ondropfiles={canWrite ? (folder, transfer) => void drop(transfer, folder) : undefined}
						onmove={canWrite ? moveInto : undefined}
					>
						{#snippet folderTrailing(folder)}
							{#if canWrite}
								<Button
									variant="ghost"
									size="icon"
									aria-label="Rename {folder.path}"
									onclick={() => startNaming('folder', folder.path)}
								>
									<PencilIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label="Delete the folder {folder.path}"
									onclick={() => deletePaths([folder.path])}
								>
									<TrashIcon />
								</Button>
							{/if}
						{/snippet}
						{#snippet trailing(file)}
							{#if file.deleted}
								<span class="ms-auto shrink-0 text-xs text-muted-foreground"
									>{formatBytes(file.size)}</span
								>
								{#if canWrite}
									<Button
										variant="ghost"
										size="icon"
										aria-label="Keep {file.path}"
										onclick={() => undoChange(file.original)}
									>
										<ArrowBackUpIcon />
									</Button>
								{/if}
							{:else}
								{#if file.pending}
									<Button
										variant="ghost"
										size="icon"
										class="ms-auto"
										aria-label="Discard the new file {file.path}"
										onclick={() => askDiscard([file.path])}
									>
										<TrashIcon />
									</Button>
								{:else}
									<span class="shrink-0 text-xs text-muted-foreground"
										>{formatBytes(file.size)}</span
									>
								{/if}
								{#if canWrite && !file.pending}
									{#if file.moved}
										<Button
											variant="ghost"
											size="icon"
											aria-label="Undo moving {file.original}"
											onclick={() => undoChange(file.original)}
										>
											<ArrowBackUpIcon />
										</Button>
									{/if}
									<Button
										variant="ghost"
										size="icon"
										aria-label="Rename {file.path}"
										onclick={() => startNaming('file', file.path)}
									>
										<PencilIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Delete {file.path}"
										onclick={() => deletePaths([file.path])}
									>
										<TrashIcon />
									</Button>
								{/if}
							{/if}
						{/snippet}
					</FileTree>
				{:else}
					<p class="p-2 text-sm text-muted-foreground">
						No config files{canWrite
							? ' yet. Drop files or a folder here, or use the buttons above.'
							: '.'}
					</p>
				{/if}
			</div>
		</div>

		<div
			class={cn(
				'grid h-full min-h-0 min-w-0 content-start gap-3',
				open !== null ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-1'
			)}
		>
			{#if open === null}
				<Empty.Root class="border border-dotted p-8">
					<Empty.Header>
						<Empty.Title>Choose a file</Empty.Title>
						<Empty.Description>
							Pick a text file on the left to read it{canWrite ? ', or make a new one' : ''}.
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				<div class="flex flex-wrap items-center gap-2">
					<span class="min-w-0 flex-1 truncate font-mono text-sm">{open}</span>
					{#if entry?.isNew}
						<span class="text-xs text-muted-foreground">New file, not saved yet</span>
					{:else if dirty}
						<span class="text-xs text-muted-foreground">Unsaved changes</span>
					{/if}
					{#if canWrite}
						{#if formatKind(open)}
							<Button variant="outline" onclick={format} disabled={file?.loading}>
								<WandIcon />Format
							</Button>
							<Separator orientation="vertical" />
						{/if}
						<Button variant="ghost" onclick={discardEdits} disabled={!unsaved}>Discard</Button>
						<Button onclick={save} loading={saving} disabled={!unsaved}>Save</Button>
					{/if}
				</div>
				{#if file?.error}
					<p class="text-sm text-destructive" role="alert">
						{message(file.error, 'Could not open this file.')}
					</p>
				{:else if entry && (entry.isNew || file?.current)}
					{#key open}
						<CodeEditor
							bind:value={entry.content}
							filename={open}
							modelKey="{id}/{open}"
							readonly={!canWrite}
							onsave={save}
							onformat={canWrite ? format : undefined}
							class="max-md:h-96"
						/>
					{/key}
				{/if}
			{/if}
		</div>
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={namingOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{naming?.from
					? 'Rename or move'
					: naming?.kind === 'folder'
						? 'New folder'
						: 'New config file'}
			</Dialog.Title>
			<Dialog.Description>
				{#if naming?.from}
					The path inside the server folder. A new folder in the path is made for you.
				{:else}
					Made in <span class="font-mono">{naming?.dir || 'overrides'}</span>{naming?.kind ===
					'folder'
						? ', and kept once it holds a file.'
						: '.'}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if naming}
			<form
				class="grid gap-4"
				onsubmit={(e) => {
					e.preventDefault();
					void confirmName();
				}}
			>
				<Field.Field data-invalid={shownError ? true : undefined}>
					<Field.Label for="config-path">{naming.from ? 'Path' : 'Name'}</Field.Label>
					<Input
						id="config-path"
						bind:value={naming.value}
						placeholder={naming.from ? undefined : naming.kind === 'folder' ? 'sodium' : 'mod.toml'}
						class="font-mono"
						autocomplete="off"
						aria-invalid={shownError ? true : undefined}
						aria-describedby="config-path-help"
					/>
					{#if shownError}
						<Field.Error id="config-path-help">{shownError}</Field.Error>
					{:else}
						<Field.Description id="config-path-help">{nameHint}</Field.Description>
					{/if}
				</Field.Field>
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={() => (namingOpen = false)}>Cancel</Button>
					<Button type="submit" disabled={!!nameError}>
						{naming.from ? 'Move' : 'Create'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	bind:open={discardOpen}
	onOpenChange={(isOpen) => {
		if (!isOpen) discarding = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard your changes?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if discarding?.all}
					{changeCount}
					{changeCount === 1 ? 'file has' : 'files have'} changes that have not been saved: edits, new
					files, moves or deletes. All of them are dropped.
				{:else if discarding && discarding.paths.length > 1}
					{discarding.paths.length} files have changes that have not been saved.
				{:else if discarding && drafts[discarding.paths[0]]?.isNew}
					This new file has not been saved yet.
				{:else}
					The edits to this file have not been saved.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={discard}>Discard</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={bulkMoveOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Move {chosenLabel}</Dialog.Title>
			<Dialog.Description>
				Into the folder you choose, each keeping its name. Nothing moves if a name is already there.
			</Dialog.Description>
		</Dialog.Header>
		<Field.Field>
			<Field.Label for="move-to">Move to</Field.Label>
			<SelectMenu id="move-to" bind:value={moveTo} options={moveOptions} />
		</Field.Field>
		<Dialog.Footer>
			<Button type="button" variant="ghost" onclick={() => (bulkMoveOpen = false)}>Cancel</Button>
			<Button onclick={bulkMove}>Move</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if canWrite && changeCount}
	<SaveBar
		{changeCount}
		noun={['file', 'files']}
		error={saveError}
		{saving}
		canSave={!saving}
		saveLabel="Save all"
		discardLabel="Discard all"
		onsave={() => saveAll()}
		ondiscard={() => askDiscardAll()}
	/>
{/if}

{#if chosen.length}
	<SelectionBar
		label={chosenLabel}
		raised={canWrite && changeCount > 0}
		onclear={() => (selection = new Set())}
	>
		{#if canWrite}
			<Button variant="ghost" size="sm" onclick={bulkDelete}>
				<TrashIcon />Delete
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onclick={() => {
					moveTo = '';
					bulkMoveOpen = true;
				}}
			>
				<ArrowsMoveIcon />Move
			</Button>
		{/if}
		<Button
			variant="ghost"
			size="sm"
			loading={downloading}
			disabled={!canDownload}
			title={canDownload ? undefined : 'Save first: new and moved files are not in the pack yet'}
			onclick={download}
		>
			<DownloadIcon />Download
		</Button>
	</SelectionBar>
{/if}
