<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
	import ArrowsMoveIcon from '@tabler/icons-svelte/icons/arrows-move';
	import DotsIcon from '@tabler/icons-svelte/icons/dots';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FilePlusIcon from '@tabler/icons-svelte/icons/file-plus';
	import FileTextIcon from '@tabler/icons-svelte/icons/file-text';
	import FileZipIcon from '@tabler/icons-svelte/icons/file-zip';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';
	import FolderOpenIcon from '@tabler/icons-svelte/icons/folder-open';
	import FolderPlusIcon from '@tabler/icons-svelte/icons/folder-plus';
	import LockIcon from '@tabler/icons-svelte/icons/lock';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import WandIcon from '@tabler/icons-svelte/icons/wand';
	import {
		createSortedRowModel,
		createTable,
		createTableState,
		rowSelectionFeature,
		rowSortingFeature,
		sortFn_alphanumeric,
		tableFeatures,
		type SortingState
	} from '@tanstack/svelte-table';
	import { onDestroy, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';

	import type { FileEntry } from '#lib/server/files.js';

	import CodeEditor from '#lib/components/config-editor/code-editor.svelte';
	import UploadDialog from '#lib/components/files/upload-dialog.svelte';
	import FolderPicker from '#lib/components/folder-picker.svelte';
	import Notice from '#lib/components/notice.svelte';
	import SaveBar from '#lib/components/save-bar.svelte';
	import SelectionBar from '#lib/components/selection-bar.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { formatConfig, formatKind } from '#lib/config-format.js';
	import { DragMove } from '#lib/drag-move.svelte.js';
	import { isEditable } from '#lib/editable.js';
	import { canMoveInto } from '#lib/file-tree.js';
	import {
		listFiles,
		newFile,
		newFolder,
		readFile,
		moveFiles,
		removeFile,
		removeFiles,
		renameFile,
		saveFiles
	} from '#lib/files.remote.js';
	import { insideAny } from '#lib/folder-picker.js';
	import { formatBytes } from '#lib/format.js';
	import { readDropped, type UploadItem } from '#lib/upload-entries.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// the folder being shown, relative to the server folder ('' is the root); it lives in the URL
	const path = $derived(page.url.searchParams.get('path') ?? '');
	const listing = $derived(listFiles({ id, path }));
	const crumbs = $derived(path ? path.split('/') : []);
	const parent = $derived(crumbs.slice(0, -1).join('/'));

	const join = (name: string) => (path ? `${path}/${name}` : name);
	const open = (to: string) =>
		goto(`/instances/${id}/files${to ? `?path=${encodeURIComponent(to)}` : ''}`);
	const downloadUrl = (to: string) =>
		`/instances/${id}/files/download?path=${encodeURIComponent(to)}`;

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	const size = formatBytes;
	const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

	type Prompt = { kind: 'folder' | 'file' | 'rename'; target?: string; value: string };
	let prompt = $state<Prompt>({ kind: 'folder', value: '' });
	let promptOpen = $state(false);
	const ask = (next: Prompt) => {
		prompt = next;
		promptOpen = true;
	};
	let promptBusy = $state(false);

	async function submitPrompt(e: SubmitEvent) {
		e.preventDefault();
		if (promptBusy) return;
		promptBusy = true;
		try {
			const name = prompt.value.trim();
			if (prompt.kind === 'folder') await newFolder({ id, path, name });
			else if (prompt.kind === 'file') await newFile({ id, path, name });
			else {
				await renameFile({ id, path: prompt.target!, name });
				rekeyDrafts(prompt.target!, joinIn(parentOf(prompt.target!), name));
			}
			promptOpen = false;
		} catch (err) {
			toast.error(message(err, 'That did not work'));
		} finally {
			promptBusy = false;
		}
	}

	const under = (candidate: string, folder: string) =>
		candidate === folder || candidate.startsWith(`${folder}/`);
	/** `candidate` as it reads once the path `from` has become `to`. */
	const rebase = (candidate: string, from: string, to: string) =>
		under(candidate, from) ? `${to}${candidate.slice(from.length)}` : candidate;
	const parentOf = (full: string) => full.split('/').slice(0, -1).join('/');
	const nameOf = (full: string) => full.slice(full.lastIndexOf('/') + 1);
	const joinIn = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

	// Every file opened here keeps its own text, so closing the editor or opening another file never
	// loses an edit. `loaded` is what the server had when it was read (or last saved) and `hash` is
	// what a save builds on.
	type Draft = { content: string; loaded: string; hash?: string };
	let editing = $state<string | null>(null);
	let editorOpen = $state(false);
	let drafts = $state<Record<string, Draft>>({});
	const openDraft = $derived(editing ? drafts[editing] : undefined);
	const isDirty = (d: Draft) => d.content !== d.loaded;
	const unsavedPaths = $derived(
		Object.entries(drafts)
			.filter(([, d]) => isDirty(d))
			.map(([path]) => path)
	);
	const dirty = $derived(openDraft ? isDirty(openDraft) : false);
	const file = $derived(editing ? readFile({ id, path: editing }) : null);
	let editorShown = false;

	// load the file into the editor when it is opened, and again after a save
	$effect(() => {
		const current = file?.current;
		const target = editing;
		if (!current || !target) return;
		untrack(() => {
			const draft = drafts[target];
			if (!draft) return;
			if (draft.content === draft.loaded) draft.content = current.content;
			draft.loaded = current.content;
			draft.hash = current.hash;
		});
	});

	// the editor keeps each file's text and undo history; free them when the page goes
	onDestroy(() => {
		if (editorShown)
			void import('#lib/components/config-editor/monaco.js').then((editor) =>
				editor.disposeModels(`instance-${id}/`)
			);
	});

	function openEditor(to: string) {
		editing = to;
		editorOpen = true;
		editorShown = true;
		drafts[to] ??= { content: '', loaded: '' };
	}

	const closeEditor = () => (editorOpen = false);

	// the editor keeps undo history by path, so a file made later at this path would inherit it
	function forgetHistory(path: string) {
		if (editorShown)
			void import('#lib/components/config-editor/monaco.js').then((editor) =>
				editor.disposeModelsAt(`instance-${id}/`, path)
			);
	}

	/** Drops the texts held for a file, or for everything in a folder; closes the editor if it was on one. */
	function dropDrafts(path: string) {
		for (const key of Object.keys(drafts)) if (under(key, path)) delete drafts[key];
		if (editing && under(editing, path)) {
			editing = null;
			editorOpen = false;
		}
		forgetHistory(path);
	}

	/** Moves the texts held for a file, or for everything in a folder, to where it went. */
	function rekeyDrafts(from: string, to: string) {
		for (const key of Object.keys(drafts)) {
			if (!under(key, from)) continue;
			drafts[rebase(key, from, to)] = drafts[key];
			delete drafts[key];
		}
		if (editing && under(editing, from)) editing = rebase(editing, from, to);
		forgetHistory(from);
	}

	let deleting = $state({ path: '', name: '', kind: '' });
	let deleteOpen = $state(false);

	async function remove() {
		const target = deleting;
		deleteOpen = false;
		try {
			await removeFile({ id, path: target.path });
			dropDrafts(target.path);
			toast.success(`Deleted ${target.name}`);
		} catch (e) {
			toast.error(message(e, 'Delete failed'));
		}
	}

	let saving = $state(false);
	let saveError = $state<string>();
	// the file a failed save names, marked in the list
	let failedPath = $state<string>();

	$effect(() => {
		if (unsavedPaths.length) return;
		saveError = undefined;
		failedPath = undefined;
	});

	/** Saves these files together; one that fails stops them all. */
	async function saveAll(paths: string[]) {
		if (saving) return;
		const sent = paths.flatMap((path) => {
			const draft = drafts[path];
			return draft?.hash && isDirty(draft)
				? [{ path, content: draft.content, baseHash: draft.hash }]
				: [];
		});
		if (!sent.length) return;
		saving = true;
		saveError = undefined;
		failedPath = undefined;
		try {
			const { hashes } = await saveFiles({ id, files: sent });
			for (const { path, content } of sent) {
				const draft = drafts[path];
				if (!draft) continue;
				// edits made while the save was going out stay unsaved
				draft.loaded = content;
				draft.hash = hashes[path];
			}
			toast.success(sent.length === 1 ? 'Saved' : `Saved ${sent.length} files`);
		} catch (e) {
			const text = message(e, 'Save failed');
			const refused = (e as { body?: App.Error }).body;
			saveError = text;
			failedPath = sent.find((f) => f.path === refused?.path)?.path;
			if (failedPath && refused?.reason === 'stale') {
				const path = failedPath;
				toast.error(text, {
					action: { label: 'Reload', onClick: () => askDiscard([path], () => void refetch(path)) }
				});
			} else toast.error(text);
		} finally {
			saving = false;
		}
	}

	const save = () => (editing ? saveAll([editing]) : undefined);

	/** Reads a file again, as the server has it now, replacing what was in the editor. */
	async function refetch(path: string) {
		try {
			await readFile({ id, path }).refresh();
			const fresh = await readFile({ id, path });
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

	/** Puts a file back to its saved text (undo brings the edits back). */
	function revert(path: string) {
		const draft = drafts[path];
		if (!draft) return;
		draft.content = draft.loaded;
		// a save refused this file as out of date, so what it was read as is stale too
		if (path === failedPath) void refetch(path);
	}

	let discarding = $state<{ paths: string[]; then?: () => void } | null>(null);
	let discardOpen = $state(false);

	function askDiscard(paths: string[], then?: () => void) {
		discarding = { paths, then };
		discardOpen = true;
	}

	/** The dialog's Discard: close it first, so nothing the action does can leave it open. */
	function discard() {
		discardOpen = false;
		const asked = discarding;
		discarding = null;
		if (!asked) return;
		for (const path of asked.paths) revert(path);
		asked.then?.();
	}

	// SvelteKit also runs this when the tab is closed or reloaded, where cancel() asks the browser
	beforeNavigate((navigation) => {
		// moving between folders only changes the query; the drafts stay
		if (navigation.to?.url.pathname === page.url.pathname) return;
		if (!unsavedPaths.length) return;
		navigation.cancel();
		if (navigation.type === 'leave' || !navigation.to) return;
		const { url } = navigation.to;
		askDiscard(unsavedPaths, () => void goto(url));
	});

	async function format() {
		if (!editing || !openDraft) return;
		try {
			openDraft.content = await formatConfig(editing, openDraft.content);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not format this file');
		}
	}

	const features = tableFeatures({
		rowSortingFeature,
		rowSelectionFeature,
		sortedRowModel: createSortedRowModel(),
		sortFns: { alphanumeric: sortFn_alphanumeric }
	});
	const [sorting, setSorting] = createTableState<SortingState>([{ id: 'name', desc: false }]);
	type Row = { original: FileEntry };

	// changing a world under a running server corrupts it, so those entries are read-only until it stops
	const running = $derived(listing.current?.running ?? false);
	const blocked = (entry: FileEntry) => entry.locked || (running && entry.inWorld);
	const worldShown = $derived(listing.current?.entries.some((e) => e.inWorld) ?? false);
	const editingEntry = $derived(
		listing.current?.entries.find((e) => editing !== null && join(e.name) === editing)
	);

	// folders stay on top in either direction: the table flips the result of a descending sort,
	// so the folder rule is flipped first to cancel that out
	const foldersFirst = (compare: (a: FileEntry, b: FileEntry) => number) => (a: Row, b: Row) => {
		const folders = Number(b.original.kind === 'dir') - Number(a.original.kind === 'dir');
		if (folders) return sorting()[0]?.desc ? -folders : folders;
		return compare(a.original, b.original);
	};
	const columns = [
		{
			accessorKey: 'name',
			sortFn: foldersFirst((a, b) =>
				a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
			)
		},
		{ accessorKey: 'size', sortFn: foldersFirst((a, b) => a.size - b.size) },
		{
			accessorKey: 'modified',
			sortFn: foldersFirst((a, b) => a.modified - b.modified)
		}
	];
	const table = createTable({
		features,
		columns,
		get data() {
			return listing.current?.entries ?? [];
		},
		getRowId: (entry: FileEntry) => entry.name,
		enableRowSelection: (row: { original: FileEntry }) => !blocked(row.original),
		enableMultiSort: false,
		enableSortingRemoval: false,
		state: {
			get sorting() {
				return sorting();
			}
		},
		onSortingChange: setSorting
	});
	const rows = $derived(table.getRowModel().rows);
	const selectedCount = $derived(Object.keys(table.atoms.rowSelection.get()).length);

	// a selection belongs to the folder it was made in
	$effect(() => {
		void path;
		untrack(() => table.resetRowSelection(true));
	});

	const sortOf = (column: string) => {
		const active = sorting()[0];
		return active?.id === column ? (active.desc ? 'descending' : 'ascending') : 'none';
	};
	const sortBy = (column: string) => {
		const active = sorting()[0];
		setSorting([{ id: column, desc: active?.id === column && !active.desc }]);
	};

	// The rows chosen with the checkboxes, as paths in the server folder.
	const chosen = $derived(table.getSelectedRowModel().rows.map((row) => join(row.original.name)));
	const chosenLabel = $derived(`${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`);
	const chosenUnsaved = $derived(unsavedPaths.filter((path) => chosen.some((c) => under(path, c))));

	let bulkOpen = $state(false);
	let moveOpen = $state(false);
	let moveTo = $state('');
	let downloading = $state(false);

	async function removeSelected() {
		bulkOpen = false;
		const paths = chosen;
		try {
			await removeFiles({ id, paths });
			for (const removed of paths) dropDrafts(removed);
			table.resetRowSelection(true);
			toast.success(`Deleted ${paths.length} ${paths.length === 1 ? 'item' : 'items'}`);
		} catch (e) {
			toast.error(message(e, 'Delete failed'));
		}
	}

	/** Moves these paths into `folder`, each keeping its name; false when it was refused. */
	async function moveInto(paths: string[], folder: string) {
		try {
			await moveFiles({ id, paths, folder });
			for (const from of paths) {
				const to = joinIn(folder, nameOf(from));
				if (to !== from) rekeyDrafts(from, to);
			}
			const what = paths.length === 1 ? nameOf(paths[0]) : `${paths.length} items`;
			toast.success(`Moved ${what} to ${folder || 'the server folder'}`);
			return true;
		} catch (e) {
			toast.error(message(e, 'Move failed'));
			return false;
		}
	}

	async function moveSelected() {
		moveOpen = false;
		if (await moveInto(chosen, moveTo)) table.resetRowSelection(true);
	}

	/** The folders in a folder that can take a move: not the install's, nor a running server's world. */
	async function foldersIn(folder: string) {
		const { entries, running: busy } = await listFiles({ id, path: folder });
		return entries
			.filter((e) => e.kind === 'dir' && !e.locked && !(busy && e.inWorld))
			.map((e) => joinIn(folder, e.name));
	}

	// Dragging rows onto a folder row, a crumb or the back button moves them like the Move dialog does.
	const chosenSet = $derived(new Set(chosen));
	const drag = new DragMove({
		onmove: () => (paths, folder) => {
			const carriedSelection = paths.some((moved) => chosen.includes(moved));
			void moveInto(paths, folder).then((moved) => {
				if (moved && carriedSelection) table.resetRowSelection(true);
			});
		}
	});

	/** The handlers that make an element take dragged rows into `folder`, lit up as `lit`. */
	const takes = (folder: string, lit = folder) => ({
		ondragover: (event: DragEvent) => void drag.over(event, folder, lit),
		ondragleave: (event: DragEvent) => drag.leave(event),
		ondrop: (event: DragEvent) => void drag.drop(event, folder)
	});
	const litClass = 'bg-accent ring-2 ring-ring/50';

	async function downloadSelected() {
		downloading = true;
		try {
			const body = new FormData();
			for (const selected of chosen) body.append('path', selected);
			const res = await fetch(`/instances/${id}/files/download`, { method: 'POST', body });
			if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
			const name = /filename\*=UTF-8''([^;]+)/.exec(
				res.headers.get('Content-Disposition') ?? ''
			)?.[1];
			const link = document.createElement('a');
			link.href = URL.createObjectURL(await res.blob());
			link.download = name ? decodeURIComponent(name) : 'files.zip';
			link.click();
			setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
		} catch (e) {
			toast.error(e instanceof Error && e.message ? e.message : 'Could not make the zip');
		} finally {
			downloading = false;
		}
	}

	let uploadOpen = $state(false);
	// where the upload dialog puts things, and what it starts with: the folder shown, or one that files were dropped on
	let uploadFolder = $state('');
	let uploadInitial = $state.raw<UploadItem[]>([]);

	function openUpload(folder: string, initial: UploadItem[] = []) {
		uploadFolder = folder;
		uploadInitial = initial;
		uploadOpen = true;
	}

	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

	/** A folder row takes dragged rows into it and files dragged in from the desktop. */
	const takesRowsAndFiles = (folder: string) => ({
		ondragover: (event: DragEvent) => {
			if (drag.over(event, folder) || !hasFiles(event)) return;
			event.preventDefault();
			drag.target = folder;
		},
		ondragleave: (event: DragEvent) => drag.leave(event),
		ondrop: (event: DragEvent) => {
			if (drag.drop(event, folder)) return;
			if (!event.dataTransfer || !hasFiles(event)) return;
			event.preventDefault();
			drag.target = null;
			// read now, not after the first wait: the browser empties the drop once this returns
			void readDropped(event.dataTransfer).then(
				(items) => {
					if (items.length) openUpload(folder, items);
				},
				() => toast.error('Could not read what was dropped')
			);
		}
	});

	function activate(entry: { name: string; kind: string }) {
		if (entry.kind === 'dir') void open(join(entry.name));
		else if (entry.kind === 'file' && isEditable(entry.name)) openEditor(join(entry.name));
	}
</script>

{#snippet sortable(column: string, label: string)}
	<button
		type="button"
		class="inline-flex items-center gap-1 hover:text-foreground"
		onclick={() => sortBy(column)}
	>
		{label}
		{#if sortOf(column) === 'ascending'}
			<ArrowUpIcon class="size-3.5" />
		{:else if sortOf(column) === 'descending'}
			<ArrowDownIcon class="size-3.5" />
		{/if}
	</button>
{/snippet}

<!-- fills the tab: header and toolbar stay put, only the list scrolls -->
<Card.Root class="min-h-0 flex-1 gap-0 overflow-hidden py-0">
	<Card.Header class="shrink-0 border-b py-3">
		<div class="flex min-w-0 items-center gap-2">
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Back to the parent folder"
				title="Back"
				disabled={!path}
				onclick={() => open(parent)}
				class={drag.target === 'back' ? litClass : undefined}
				{...takes(parent, 'back')}
			>
				<ArrowLeftIcon />
			</Button>
			<Breadcrumb.Root class="min-w-0">
				<Breadcrumb.List class="flex-nowrap">
					<Breadcrumb.Item>
						{#if path}
							<Breadcrumb.Link
								href="/instances/{id}/files"
								onclick={(e) => (e.preventDefault(), open(''))}
								class={['-mx-1 rounded-sm px-1', drag.target === '' && litClass]}
								{...takes('')}
							>
								server
							</Breadcrumb.Link>
						{:else}
							<Breadcrumb.Page>server</Breadcrumb.Page>
						{/if}
					</Breadcrumb.Item>
					{#each crumbs as crumb, i (i)}
						{@const to = crumbs.slice(0, i + 1).join('/')}
						<Breadcrumb.Separator />
						<Breadcrumb.Item class="min-w-0">
							{#if i < crumbs.length - 1}
								<Breadcrumb.Link
									class={['-mx-1 truncate rounded-sm px-1', drag.target === to && litClass]}
									href="/instances/{id}/files?path={encodeURIComponent(to)}"
									onclick={(e) => (e.preventDefault(), open(to))}
									{...takes(to)}
								>
									{crumb}
								</Breadcrumb.Link>
							{:else}
								<Breadcrumb.Page class="truncate">{crumb}</Breadcrumb.Page>
							{/if}
						</Breadcrumb.Item>
					{/each}
				</Breadcrumb.List>
			</Breadcrumb.Root>
		</div>
		<Card.Action class="flex flex-wrap gap-2">
			<Button variant="outline" size="sm" onclick={() => openUpload(path)}>
				<UploadIcon />Upload
			</Button>
			<Button variant="outline" size="sm" onclick={() => ask({ kind: 'folder', value: '' })}>
				<FolderPlusIcon />New folder
			</Button>
			<Button variant="outline" size="sm" onclick={() => ask({ kind: 'file', value: '' })}>
				<FilePlusIcon />New file
			</Button>
			<Button variant="outline" size="sm" href={downloadUrl(path)} download>
				<FileZipIcon />Download as zip
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex min-h-0 flex-1 flex-col px-0">
		{#if running && worldShown}
			<p
				class="shrink-0 border-b bg-muted/40 px-6 py-2 text-sm text-muted-foreground"
				role="status"
			>
				The server is running, so the world is read-only. Stop the server to change it.
			</p>
		{/if}
		<!-- the table scrolls inside its own container so the header can stick to it -->
		<Table.Root containerClass="min-h-0 flex-1 overflow-y-auto">
			<Table.Header class="sticky top-0 z-10 bg-card">
				<Table.Row>
					<Table.Head class="w-10 ps-6">
						<Checkbox
							aria-label="Select all"
							checked={table.getIsAllRowsSelected()}
							indeterminate={table.getIsSomeRowsSelected()}
							onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
						/>
					</Table.Head>
					<Table.Head aria-sort={sortOf('name')}>{@render sortable('name', 'Name')}</Table.Head>
					<Table.Head class="w-28 text-end" aria-sort={sortOf('size')}>
						{@render sortable('size', 'Size')}
					</Table.Head>
					<Table.Head class="hidden w-48 sm:table-cell" aria-sort={sortOf('modified')}>
						{@render sortable('modified', 'Modified')}
					</Table.Head>
					<Table.Head class="w-12 pe-6"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as row (row.id)}
					{@const entry = row.original}
					{@const to = join(entry.name)}
					{@const editable = entry.kind === 'file' && isEditable(entry.name)}
					{@const droppable = entry.kind === 'dir' && !blocked(entry)}
					<Table.Row
						data-state={row.getIsSelected() ? 'selected' : undefined}
						draggable={!blocked(entry)}
						ondragstart={(event) => drag.start(event, to, chosenSet)}
						ondragend={() => drag.end()}
						class={droppable && drag.target === to ? `${litClass} hover:bg-accent` : undefined}
						{...droppable ? takesRowsAndFiles(to) : {}}
					>
						<Table.Cell class="ps-6">
							<Checkbox
								aria-label="Select {entry.name}"
								checked={row.getIsSelected()}
								disabled={blocked(entry)}
								onCheckedChange={(value) => row.toggleSelected(!!value)}
							/>
						</Table.Cell>
						<Table.Cell>
							<button
								type="button"
								class="flex max-w-full items-center gap-2 text-start hover:underline disabled:no-underline"
								disabled={entry.kind === 'link' || (entry.kind === 'file' && !editable)}
								onclick={() => activate(entry)}
							>
								{#if entry.kind === 'dir'}
									<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
								{:else if editable}
									<FileTextIcon class="size-4 shrink-0 text-muted-foreground" />
								{:else}
									<FileIcon class="size-4 shrink-0 text-muted-foreground" />
								{/if}
								<span class="truncate">{entry.name}</span>
								{#if drafts[to] && isDirty(drafts[to])}
									<span
										class="size-2 shrink-0 rounded-full {to === failedPath
											? 'bg-destructive'
											: 'bg-warning'}"
										title={to === failedPath ? 'Stopped the save' : 'Unsaved changes'}
									></span>
									<span class="sr-only"
										>{to === failedPath ? 'Stopped the save' : 'Unsaved changes'}</span
									>
								{/if}
								{#if entry.kind === 'link'}
									<span class="text-xs text-muted-foreground">(link)</span>
								{/if}
								{#if entry.locked}
									<LockIcon
										class="size-3.5 shrink-0 text-muted-foreground"
										aria-label="Part of the server install, it cannot be deleted or renamed"
									/>
								{/if}
							</button>
						</Table.Cell>
						<Table.Cell class="text-end text-muted-foreground">
							{entry.kind === 'dir' ? '' : size(entry.size)}
						</Table.Cell>
						<Table.Cell class="hidden text-muted-foreground sm:table-cell">
							{date.format(new Date(entry.modified))}
						</Table.Cell>
						<Table.Cell class="pe-6">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-sm"
											aria-label="Actions for {entry.name}"
										>
											<DotsIcon />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									{#if editable}
										<DropdownMenu.Item onSelect={() => openEditor(to)}>
											<PencilIcon />Edit
										</DropdownMenu.Item>
									{/if}
									{#if entry.kind !== 'link'}
										<DropdownMenu.Item
											onSelect={() => {
												location.href = downloadUrl(to);
											}}
										>
											<DownloadIcon />{entry.kind === 'dir' ? 'Download as zip' : 'Download'}
										</DropdownMenu.Item>
									{/if}
									<DropdownMenu.Item
										disabled={blocked(entry)}
										onSelect={() => ask({ kind: 'rename', target: to, value: entry.name })}
									>
										<PencilIcon />Rename
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										variant="destructive"
										disabled={blocked(entry)}
										onSelect={() => {
											deleting = { path: to, name: entry.name, kind: entry.kind };
											deleteOpen = true;
										}}
									>
										<TrashIcon />Delete
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#if !listing.current && !listing.error}
						{#each [0, 1, 2, 3, 4, 5] as i (i)}
							<Table.Row>
								<Table.Cell class="ps-6"><Skeleton class="size-4" /></Table.Cell>
								<Table.Cell><Skeleton class="h-4 w-40" /></Table.Cell>
								<Table.Cell><Skeleton class="ms-auto h-4 w-14" /></Table.Cell>
								<Table.Cell class="hidden sm:table-cell"><Skeleton class="h-4 w-32" /></Table.Cell>
								<!-- as tall as the action button, so rows do not change height when data arrives -->
								<Table.Cell class="pe-6"><Skeleton class="size-7" /></Table.Cell>
							</Table.Row>
						{/each}
					{:else if listing.current}
						<Table.Row>
							<Table.Cell colspan={5}>
								<Empty.Root class="border-0 py-10">
									<Empty.Header>
										<Empty.Media variant="icon"><FolderOpenIcon /></Empty.Media>
										<Empty.Title>This folder is empty</Empty.Title>
										<Empty.Description
											>Upload files or create a new file or folder.</Empty.Description
										>
									</Empty.Header>
								</Empty.Root>
							</Table.Cell>
						</Table.Row>
					{/if}
				{/each}
			</Table.Body>
		</Table.Root>
		{#if listing.error}
			<p class="px-6 pt-3 text-sm text-destructive" role="alert">
				{message(listing.error, 'Could not read this folder.')}
			</p>
		{/if}
	</Card.Content>
</Card.Root>

<UploadDialog bind:open={uploadOpen} instanceId={id} path={uploadFolder} initial={uploadInitial} />

<Dialog.Root bind:open={promptOpen}>
	<Dialog.Content>
		<form onsubmit={submitPrompt} class="grid gap-4">
			<Dialog.Header>
				<Dialog.Title>
					{prompt.kind === 'folder' ? 'New folder' : prompt.kind === 'file' ? 'New file' : 'Rename'}
				</Dialog.Title>
				{#if prompt.kind === 'file'}
					<Dialog.Description>
						Text files only (.properties, .json, .toml, .yml, .cfg, .txt, ...).
					</Dialog.Description>
				{/if}
			</Dialog.Header>
			<Input bind:value={prompt.value} placeholder="Name" autocomplete="off" spellcheck="false" />
			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (promptOpen = false)}>Cancel</Button>
				<Button type="submit" loading={promptBusy} disabled={!prompt.value.trim()}>
					{prompt.kind === 'rename' ? 'Rename' : 'Create'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {deleting.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				{deleting.kind === 'dir'
					? 'The folder and everything in it will be deleted.'
					: 'The file will be deleted.'}
				This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={bulkOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {chosenLabel}?</AlertDialog.Title>
			<AlertDialog.Description>
				Folders are deleted with everything in them. This cannot be undone.
				{#if chosenUnsaved.length}
					Your unsaved edits to {chosenUnsaved.length === 1
						? 'one of them'
						: `${chosenUnsaved.length} of them`} are lost too.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeSelected}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Sheet.Root open={editorOpen} onOpenChange={(o) => !o && closeEditor()}>
	<Sheet.Content class="flex w-full flex-col overflow-hidden sm:max-w-xl!">
		<Sheet.Header>
			<Sheet.Title class="truncate">{editing}</Sheet.Title>
			<Sheet.Description>
				Changes take effect when the server next reads the file, usually at start.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
			{#if running && editingEntry?.rewritten}
				<Notice tone="warning">
					The server is running and writes this file back when it stops, so changes made now can be
					lost. Stop the server first.
				</Notice>
			{/if}
			{#if file?.error}
				<p class="text-sm text-destructive" role="alert">
					{message(file.error, 'Could not open this file.')}
				</p>
			{:else if openDraft && file?.current}
				{#key editing}
					<CodeEditor
						bind:value={openDraft.content}
						filename={editing ?? ''}
						modelKey="instance-{id}/{editing}"
						onsave={save}
						onformat={format}
						class="min-h-0 flex-1"
					/>
				{/key}
			{:else}
				<Skeleton class="min-h-0 flex-1" />
			{/if}
			<div class="flex items-center justify-end gap-2">
				{#if dirty}<span class="me-auto text-xs text-muted-foreground">Unsaved changes</span>{/if}
				{#if editing && formatKind(editing)}
					<Button variant="outline" onclick={format} disabled={!file?.current}>
						<WandIcon />Format
					</Button>
				{/if}
				<Button variant="ghost" onclick={closeEditor}>Close</Button>
				<Button variant="ghost" onclick={() => editing && revert(editing)} disabled={!dirty}>
					Discard
				</Button>
				<Button onclick={save} loading={saving} disabled={!dirty}>Save</Button>
			</div>
		</div>
	</Sheet.Content>
</Sheet.Root>

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
				{discarding && discarding.paths.length > 1
					? `${discarding.paths.length} files have changes that have not been saved.`
					: 'The edits to this file have not been saved.'}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={discard}>Discard</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={moveOpen}>
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
			list={foldersIn}
			exclude={(folder) => insideAny(folder, chosen)}
			rootLabel="server"
		/>
		<Dialog.Footer>
			<Button type="button" variant="ghost" onclick={() => (moveOpen = false)}>Cancel</Button>
			<Button class="min-w-0" disabled={!canMoveInto(chosen, moveTo)} onclick={moveSelected}>
				<span class="truncate">Move to {moveTo || 'the server folder'}</span>
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if unsavedPaths.length}
	<SaveBar
		changeCount={unsavedPaths.length}
		noun={['file', 'files']}
		error={saveError}
		{saving}
		canSave={!saving}
		saveLabel="Save all"
		discardLabel="Discard all"
		onsave={() => saveAll(unsavedPaths)}
		ondiscard={() => askDiscard(unsavedPaths)}
	/>
{/if}

{#if chosen.length}
	<SelectionBar
		label={chosenLabel}
		raised={unsavedPaths.length > 0}
		onclear={() => table.resetRowSelection(true)}
	>
		<Button variant="ghost" size="sm" onclick={() => (bulkOpen = true)}>
			<TrashIcon />Delete
		</Button>
		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				moveTo = path;
				moveOpen = true;
			}}
		>
			<ArrowsMoveIcon />Move
		</Button>
		<Button variant="ghost" size="sm" loading={downloading} onclick={downloadSelected}>
			<DownloadIcon />Download
		</Button>
	</SelectionBar>
{/if}
