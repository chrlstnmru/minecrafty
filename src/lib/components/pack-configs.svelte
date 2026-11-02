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
	import DiscardDialog from '#lib/components/discard-dialog.svelte';
	import FileTree from '#lib/components/file-tree.svelte';
	import FolderPicker from '#lib/components/folder-picker.svelte';
	import SaveBar from '#lib/components/save-bar.svelte';
	import SelectionBar from '#lib/components/selection-bar.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { formatKind } from '#lib/config-format.js';
	import { isEditable } from '#lib/editable.js';
	import { FileDrafts, type SaveResult } from '#lib/file-drafts.svelte.js';
	import {
		buildFileTree,
		canMoveInto,
		decodeDrag,
		TREE_DRAG_TYPE,
		topLevelPaths
	} from '#lib/file-tree.js';
	import { childFolders, insideAny } from '#lib/folder-picker.js';
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

	// the panel is made again for another pack, so its first id is the one it keeps
	const drafts = new FileDrafts(`pack-${untrack(() => id)}`, {
		// the open file is read from where it is on the server, even when a move is waiting for it
		read: (path) => {
			const original = originalOf(view, path);
			return original === undefined ? null : readPackConfig({ id, path: original });
		},
		// `only` limits a save to the edits of those files and the moves that belong to them
		save: async (sent, only) => {
			const originals = new Set(
				(only ?? []).flatMap((path) => {
					const original = originalOf(view, path);
					return original === undefined ? [] : [original];
				})
			);
			const sentStaged: Staged = only
				? Object.fromEntries(Object.entries(staged).filter(([original]) => originals.has(original)))
				: staged;
			const changes = changesOf(view, sentStaged, sent);
			if (!changes.moves.length && !changes.deletes.length && !changes.writes.length) return null;
			const count = countChanges(view, sentStaged, sent);
			const { hashes } = await savePackChanges({ id, ...changes });
			staged = Object.fromEntries(
				Object.entries(staged).filter(([original]) => !(original in sentStaged))
			);
			return { hashes, count };
		},
		count: (unsaved) => countChanges(view, staged, unsaved),
		// the server names the path as it knows it: where the file is now, or where it goes
		shownAt: (named) => view.find((f) => f.original === named || f.path === named)?.path ?? named,
		onDiscardAll: () => {
			for (const item of view) if (item.moved) drafts.rekey(item.path, item.original);
			staged = {};
		},
		report: (text) => toast.error(text)
	});

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
		...Object.entries(drafts.byPath)
			.filter(([path, d]) => d.isNew && !view.some((f) => f.path === path))
			.map(([path]) => ({ path, size: 0, pending: true }))
	]);
	const changeCount = $derived(drafts.changeCount);

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

	const open = $derived(drafts.open);
	const entry = $derived(drafts.current);
	const file = $derived(drafts.file);
	const dirty = $derived(entry ? entry.content !== entry.loaded : false);
	const unsaved = $derived(open ? drafts.dirty(open) : false);

	onDestroy(() => drafts.destroy());
	beforeNavigate((navigation) => drafts.leave(navigation, (url) => void goto(url)));

	/** The Discard button: an edit goes back to the saved text (undo brings it back), a new file is asked about. */
	function discardEdits() {
		if (!open || !entry) return;
		if (entry.isNew) drafts.askDiscard([open]);
		else drafts.revert(open);
	}

	/** Saves what is waiting together, as one revision; one part refused stops it all. */
	async function saveAll(only?: string[]) {
		if (!canWrite) return;
		const result: SaveResult = await drafts.saveAll(only);
		if (!result) return;
		if ('saved' in result) {
			toast.success(result.saved === 1 ? 'Saved' : `Saved ${result.saved} changes`);
			return;
		}
		const { message: text, path, stale } = result.failed;
		if (path && stale)
			toast.error(text, {
				action: {
					label: 'Reload',
					onClick: () => drafts.askDiscard([path], () => void drafts.refetch(path))
				}
			});
		else toast.error(text);
	}

	const save = () => (open ? saveAll([open]) : undefined);

	/** A folder that lost its last file stays in the tree, empty, rather than vanishing under the cursor. */
	function keepFolder(dir: string) {
		if (dir && !emptyFolders.includes(dir)) emptyFolders = [...emptyFolders, dir];
	}

	/** Forgets what the page held for a folder that goes: its empty-folder marks, the target and the texts. */
	function forgetFolder(path: string) {
		emptyFolders = emptyFolders.filter((folder) => !under(folder, path));
		if (under(targetDir, path)) targetDir = dirOf(path);
		drafts.drop(path);
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
				Object.keys(drafts.byPath).some((path) => under(path, from)) ||
				emptyFolders.some((folder) => under(folder, from));
			if (!here && !heldHere) {
				toast.error(`${from} not found`);
				return false;
			}
			const taken = Object.entries(drafts.byPath).find(
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
			drafts.rekey(from, to);
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
			drafts.rekey(item.path, original);
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
		drafts.show(to, { created: true });
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
								: file.path === drafts.failedPath
									? { tone: 'danger', label: 'Stopped the save' }
									: file.deleted
										? { tone: 'danger', label: 'Deleted when you save' }
										: drafts.dirty(file.path)
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
							drafts.show(file.path);
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
										onclick={() => drafts.askDiscard([file.path])}
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
							<Button variant="outline" onclick={() => drafts.format()} disabled={file?.loading}>
								<WandIcon />Format
							</Button>
							<Separator orientation="vertical" />
						{/if}
						<Button variant="ghost" onclick={discardEdits} disabled={!unsaved}>Discard</Button>
						<Button onclick={save} loading={drafts.saving} disabled={!unsaved}>Save</Button>
					{/if}
				</div>
				{#if file?.error}
					<p class="text-sm text-destructive" role="alert">
						{message(file.error, 'Could not open this file.')}
					</p>
				{:else if entry && (entry.isNew || file?.current)}
					{#key entry.key}
						<CodeEditor
							bind:value={entry.content}
							filename={open}
							modelKey={drafts.modelKey(open)}
							readonly={!canWrite}
							onsave={save}
							onformat={canWrite ? () => drafts.format() : undefined}
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

<DiscardDialog {drafts} allDetail="edits, new files, moves or deletes. All of them are dropped." />

<Dialog.Root bind:open={bulkMoveOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Move {chosenLabel}</Dialog.Title>
			<Dialog.Description>
				Open the folder to move into. Each item keeps its name, and nothing moves if a name is
				already there.
			</Dialog.Description>
		</Dialog.Header>
		<FolderPicker
			bind:folder={moveTo}
			list={(folder) => childFolders(folderPaths, folder)}
			exclude={(folder) => insideAny(folder, chosen)}
			rootLabel="overrides"
		/>
		<Dialog.Footer>
			<Button type="button" variant="ghost" onclick={() => (bulkMoveOpen = false)}>Cancel</Button>
			<Button class="min-w-0" disabled={!canMoveInto(chosen, moveTo)} onclick={bulkMove}>
				<span class="truncate">Move to {moveTo || 'the server folder'}</span>
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if canWrite && changeCount}
	<SaveBar
		{changeCount}
		noun={['file', 'files']}
		error={drafts.saveError}
		saving={drafts.saving}
		canSave={!drafts.saving}
		saveLabel="Save all"
		discardLabel="Discard all"
		onsave={() => saveAll()}
		ondiscard={() => drafts.askDiscardAll()}
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
					moveTo = target;
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
