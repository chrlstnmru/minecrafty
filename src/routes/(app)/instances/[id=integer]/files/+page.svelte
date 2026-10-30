<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DotsIcon from '@tabler/icons-svelte/icons/dots';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FilePlusIcon from '@tabler/icons-svelte/icons/file-plus';
	import FileTextIcon from '@tabler/icons-svelte/icons/file-text';
	import FileZipIcon from '@tabler/icons-svelte/icons/file-zip';
	import FolderOpenIcon from '@tabler/icons-svelte/icons/folder-open';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';
	import FolderPlusIcon from '@tabler/icons-svelte/icons/folder-plus';
	import LockIcon from '@tabler/icons-svelte/icons/lock';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
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
	import { formatBytes } from '#lib/format.js';
	import { toast } from 'svelte-sonner';
	import {
		listFiles,
		newFile,
		newFolder,
		readFile,
		removeFile,
		renameFile,
		saveFile
	} from '#lib/files.remote.js';
	import type { FileEntry } from '#lib/server/files.js';
	import UploadDialog from '#lib/components/files/upload-dialog.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';

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

	const EDITABLE =
		/\.(properties|json|json5|jsonc|toml|ya?ml|cfg|conf|ini|txt|mcmeta|xml|md|snbt|log)$/i;
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
			else await renameFile({ id, path: prompt.target!, name });
			promptOpen = false;
		} catch (err) {
			toast.error(message(err, 'That did not work'));
		} finally {
			promptBusy = false;
		}
	}

	let deleting = $state({ path: '', name: '', kind: '' });
	let deleteOpen = $state(false);

	async function remove() {
		const target = deleting;
		deleteOpen = false;
		try {
			await removeFile({ id, path: target.path });
			toast.success(`Deleted ${target.name}`);
		} catch (e) {
			toast.error(message(e, 'Delete failed'));
		}
	}

	let editing = $state<string | null>(null);
	let editorOpen = $state(false);
	let draft = $state('');
	let loaded = $state('');
	let confirmDiscard = $state(false);
	const file = $derived(editing ? readFile({ id, path: editing }) : null);
	const dirty = $derived(editorOpen && draft !== loaded);

	// load the file into the editor when it is opened, and again after a save
	$effect(() => {
		const content = file?.current?.content;
		if (content === undefined) return;
		if (draft === loaded) draft = content;
		loaded = content;
	});

	function openEditor(to: string) {
		draft = '';
		loaded = '';
		editing = to;
		editorOpen = true;
	}

	function closeEditor(force = false) {
		if (dirty && !force) {
			confirmDiscard = true;
			return;
		}
		editorOpen = false;
	}

	async function save() {
		if (!editing) return;
		try {
			await saveFile({ id, path: editing, content: draft });
			toast.success('Saved');
		} catch (e) {
			toast.error(message(e, 'Save failed'));
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

	let bulkOpen = $state(false);
	async function removeSelected() {
		bulkOpen = false;
		const names = table.getSelectedRowModel().rows.map((row) => row.original.name);
		const results = await Promise.allSettled(
			names.map((name) => removeFile({ id, path: join(name) }))
		);
		const failed = results.filter((r) => r.status === 'rejected');
		table.resetRowSelection(true);
		if (failed.length) toast.error(`${failed.length} of ${names.length} could not be deleted`);
		else toast.success(`Deleted ${names.length} ${names.length === 1 ? 'item' : 'items'}`);
	}

	let uploadOpen = $state(false);

	function activate(entry: { name: string; kind: string }) {
		if (entry.kind === 'dir') void open(join(entry.name));
		else if (entry.kind === 'file' && EDITABLE.test(entry.name)) openEditor(join(entry.name));
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
									class="truncate"
									href="/instances/{id}/files?path={encodeURIComponent(to)}"
									onclick={(e) => (e.preventDefault(), open(to))}
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
			{#if selectedCount}
				<span class="self-center text-sm text-muted-foreground">{selectedCount} selected</span>
				<Button variant="outline" size="sm" onclick={() => table.resetRowSelection(true)}>
					Clear
				</Button>
				<Button variant="destructive" size="sm" onclick={() => (bulkOpen = true)}>
					<TrashIcon />Delete
				</Button>
			{/if}
			<Button variant="outline" size="sm" onclick={() => (uploadOpen = true)}>
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
					{@const editable = entry.kind === 'file' && EDITABLE.test(entry.name)}
					<Table.Row data-state={row.getIsSelected() ? 'selected' : undefined}>
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

<UploadDialog bind:open={uploadOpen} instanceId={id} {path} />

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
			<AlertDialog.Title>Delete {selectedCount} selected?</AlertDialog.Title>
			<AlertDialog.Description>
				Folders are deleted with everything in them. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeSelected}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Sheet.Root open={editorOpen} onOpenChange={(o) => !o && closeEditor()}>
	<Sheet.Content class="flex w-full flex-col overflow-hidden sm:max-w-3xl">
		<Sheet.Header>
			<Sheet.Title class="truncate">{editing}</Sheet.Title>
			<Sheet.Description>
				Changes take effect when the server next reads the file, usually at start.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
			{#if running && editingEntry?.rewritten}
				<p
					class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
					role="status"
				>
					The server is running and writes this file back when it stops, so changes made now can be
					lost. Stop the server first.
				</p>
			{/if}
			{#if file?.error}
				<p class="text-sm text-destructive" role="alert">
					{message(file.error, 'Could not open this file.')}
				</p>
			{:else}
				<Textarea
					bind:value={draft}
					class="min-h-0 flex-1 resize-none font-mono text-xs whitespace-pre"
					wrap="off"
					spellcheck={false}
					disabled={!file?.current}
				/>
			{/if}
			<div class="flex items-center justify-end gap-2">
				{#if dirty}<span class="me-auto text-xs text-muted-foreground">Unsaved changes</span>{/if}
				<Button variant="ghost" onclick={() => closeEditor()}>Close</Button>
				<Button onClickPromise={save} disabled={!dirty}>Save</Button>
			</div>
		</div>
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root bind:open={confirmDiscard}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard your changes?</AlertDialog.Title>
			<AlertDialog.Description>The edits to this file have not been saved.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => closeEditor(true)}>Discard</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
