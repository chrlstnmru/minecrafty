<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DotsIcon from '@tabler/icons-svelte/icons/dots';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FilePlusIcon from '@tabler/icons-svelte/icons/file-plus';
	import FileTextIcon from '@tabler/icons-svelte/icons/file-text';
	import FileZipIcon from '@tabler/icons-svelte/icons/file-zip';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';
	import FolderPlusIcon from '@tabler/icons-svelte/icons/folder-plus';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
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
	import UploadDialog from '#lib/components/files/upload-dialog.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
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

	const size = (bytes: number) =>
		bytes < 1024
			? `${bytes} B`
			: bytes < 1024 ** 2
				? `${(bytes / 1024).toFixed(1)} KB`
				: bytes < 1024 ** 3
					? `${(bytes / 1024 ** 2).toFixed(1)} MB`
					: `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

	// --- name prompt: new folder, new file, rename ---
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

	// --- delete ---
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

	// --- editor ---
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

	// --- upload (a dialog: pick or drop files, or a whole folder) ---
	let uploadOpen = $state(false);

	function activate(entry: { name: string; kind: string }) {
		if (entry.kind === 'dir') void open(join(entry.name));
		else if (entry.kind === 'file' && EDITABLE.test(entry.name)) openEditor(join(entry.name));
	}
</script>

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
	<Card.Content class="min-h-0 flex-1 overflow-y-auto px-0">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="ps-6">Name</Table.Head>
					<Table.Head class="w-28 text-end">Size</Table.Head>
					<Table.Head class="hidden w-48 sm:table-cell">Modified</Table.Head>
					<Table.Head class="w-12 pe-6"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each listing.current?.entries ?? [] as entry (entry.name)}
					{@const to = join(entry.name)}
					{@const editable = entry.kind === 'file' && EDITABLE.test(entry.name)}
					<Table.Row>
						<Table.Cell class="ps-6">
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
										onSelect={() => ask({ kind: 'rename', target: to, value: entry.name })}
									>
										<PencilIcon />Rename
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										variant="destructive"
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
					{#if listing.current}
						<Table.Row>
							<Table.Cell colspan={4} class="ps-6 text-muted-foreground">
								This folder is empty.
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

<Sheet.Root open={editorOpen} onOpenChange={(o) => !o && closeEditor()}>
	<Sheet.Content class="flex w-full flex-col overflow-hidden sm:max-w-3xl">
		<Sheet.Header>
			<Sheet.Title class="truncate">{editing}</Sheet.Title>
			<Sheet.Description>
				Changes take effect when the server next reads the file, usually at start.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
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
