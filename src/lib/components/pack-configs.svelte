<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import FilePlusIcon from '@tabler/icons-svelte/icons/file-plus';
	import FolderPlusIcon from '@tabler/icons-svelte/icons/folder-plus';
	import FolderUpIcon from '@tabler/icons-svelte/icons/folder-up';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import WandIcon from '@tabler/icons-svelte/icons/wand';
	import { toast } from 'svelte-sonner';

	import {
		getLocalPack,
		movePackConfig,
		readPackConfig,
		removePackOverride,
		savePackConfig
	} from '#lib/builder.remote.js';
	import CodeEditor from '#lib/components/config-editor/code-editor.svelte';
	import FileTree from '#lib/components/file-tree.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { formatConfig, formatKind } from '#lib/config-format.js';
	import { isEditable } from '#lib/editable.js';
	import { buildFileTree } from '#lib/file-tree.js';
	import { formatBytes } from '#lib/format.js';
	import {
		batches,
		collectEntries,
		fromFileList,
		MAX_ITEMS,
		type FsEntry,
		type UploadItem
	} from '#lib/upload-entries.js';

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

	let open = $state<string | null>(null);
	// a file made here that is not on the server until the first save
	let isNew = $state(false);
	let draft = $state('');
	let loaded = $state('');
	let hash = $state<string>();

	// the new file shows in the tree before the server has it
	const listed: { path: string; size: number; pending?: boolean }[] = $derived(
		isNew && open && !files.some((f) => f.path === open)
			? [...files, { path: open, size: 0, pending: true }]
			: files
	);
	// folders made here hold no file yet, so the server has no trace of them
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

	// a folder that has gained a file is on the server now
	$effect(() => {
		const kept = emptyFolders.filter((path) => !files.some((f) => f.path.startsWith(`${path}/`)));
		if (kept.length !== emptyFolders.length) emptyFolders = kept;
	});

	const file = $derived(open && !isNew ? readPackConfig({ id, path: open }) : null);
	const dirty = $derived(open !== null && draft !== loaded);
	// a new file counts as unsaved even while empty, so it is never dropped without asking
	const unsaved = $derived(dirty || isNew);

	// load the file into the editor when it is opened, and again after a save
	$effect(() => {
		const current = file?.current;
		if (!current) return;
		if (draft === loaded) draft = current.content;
		loaded = current.content;
		hash = current.hash;
	});

	let confirmDiscard = $state(false);
	let afterDiscard = $state<(() => void) | null>(null);

	/** Runs `action` now, or once the user has agreed to drop the unsaved edits. */
	function unlessDirty(action: () => void) {
		if (!unsaved) return action();
		afterDiscard = action;
		confirmDiscard = true;
	}

	function discard() {
		if (isNew) show(null);
		else draft = loaded;
		afterDiscard?.();
		afterDiscard = null;
	}

	// SvelteKit also runs this when the tab is closed or reloaded, where cancel() asks the browser
	beforeNavigate((navigation) => {
		if (!unsaved) return;
		navigation.cancel();
		if (navigation.type === 'leave' || !navigation.to) return;
		const { url } = navigation.to;
		unlessDirty(() => void goto(url));
	});

	function show(path: string | null, created = false) {
		open = path;
		isNew = created;
		draft = '';
		loaded = '';
		hash = undefined;
	}

	async function reload() {
		draft = '';
		loaded = '';
		await file?.refresh();
	}

	async function save() {
		if (!open || !canWrite || !unsaved) return;
		try {
			await savePackConfig({
				id,
				path: open,
				content: draft,
				baseHash: isNew ? undefined : hash
			});
			isNew = false;
			toast.success('Saved');
		} catch (e) {
			const text = message(e, 'Could not save the file');
			if (text.includes('changed since you opened it'))
				toast.error(text, { action: { label: 'Reload', onClick: () => unlessDirty(reload) } });
			else toast.error(text);
		}
	}

	async function format() {
		if (!open) return;
		try {
			draft = await formatConfig(open, draft);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not format this file');
		}
	}

	async function remove(path: string) {
		try {
			await removePackOverride({ id, path });
			if (open === path) show(null);
		} catch (e) {
			toast.error(message(e, 'Could not remove the file'));
		}
	}

	let naming = $state<{ kind: 'file' | 'folder'; from?: string; value: string } | null>(null);
	let namingOpen = $state(false);

	const namedPath = $derived(
		naming
			? naming.kind === 'folder'
				? naming.value.trim().replace(/\/+$/, '')
				: naming.value.trim()
			: ''
	);

	const nameError = $derived.by(() => {
		if (!naming) return undefined;
		const path = namedPath;
		if (!path)
			return naming.kind === 'folder'
				? 'Enter a folder path, such as config/sodium'
				: 'Enter a path, such as config/mod.toml';
		if (path.startsWith('/') || path.split('/').includes('..'))
			return 'Use a path inside the server folder, without a leading slash or ..';
		if (path === naming.from) return undefined;
		const asFile = files.find((f) => f.path === path || path.startsWith(`${f.path}/`));
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

	function startNaming(kind: 'file' | 'folder', from?: string) {
		naming = { kind, from, value: from ?? (target ? `${target}/` : '') };
		namingOpen = true;
	}

	async function confirmName() {
		if (!naming || nameError) return;
		const { kind, from } = naming;
		const to = namedPath;
		namingOpen = false;
		if (kind === 'folder') {
			emptyFolders = [...emptyFolders, to];
			targetDir = to;
			return;
		}
		if (!from) {
			targetDir = dirOf(to);
			return unlessDirty(() => show(to, true));
		}
		if (from === to) return;
		try {
			await movePackConfig({ id, from, to });
			if (open === from) open = to;
			toast.success(`Moved ${from} to ${to}`);
		} catch (e) {
			toast.error(message(e, 'Could not move the file'));
		}
	}

	let uploading = $state(false);
	let dragging = $state(false);
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
		class="grid min-h-0 flex-1 gap-4 max-md:overflow-y-auto md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
	>
		<div
			role="group"
			aria-label="Config files"
			class="flex min-h-0 min-w-0 flex-col gap-1 rounded-lg border p-2 max-md:min-h-64 {dragging
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
			<div class="flex items-center gap-1 ps-1.5">
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
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if tree.length}
					<FileTree
						nodes={tree}
						selected={open}
						selectedFolder={target || null}
						selectable={(file) => isEditable(file.path)}
						unselectableTitle="Not a text file"
						status={(file) =>
							file.pending
								? { tone: 'info', label: 'New file, not saved yet' }
								: file.path === open && dirty
									? { tone: 'warning', label: 'Unsaved changes' }
									: undefined}
						folderStatus={(folder) =>
							emptyFolders.includes(folder.path)
								? { tone: 'info', label: 'New folder, kept once it holds a file' }
								: undefined}
						onselect={(file) =>
							unlessDirty(() => {
								targetDir = dirOf(file.path);
								show(file.path);
							})}
						onselectfolder={(path) => (targetDir = path)}
						ondropfiles={canWrite ? (folder, transfer) => void drop(transfer, folder) : undefined}
					>
						{#snippet trailing(file)}
							{#if file.pending}
								<Button
									variant="ghost"
									size="icon"
									class="ms-auto"
									aria-label="Discard the new file {file.path}"
									onclick={() => unlessDirty(() => show(null))}
								>
									<TrashIcon />
								</Button>
							{:else}
								<span class="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
							{/if}
							{#if canWrite && !file.pending}
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
									aria-label="Remove {file.path}"
									onClickPromise={() => remove(file.path)}
								>
									<TrashIcon />
								</Button>
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

		<div class="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] content-start gap-3">
			{#if open === null}
				<Empty.Root class="p-8">
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
					{#if isNew}
						<span class="text-xs text-muted-foreground">New file, not saved yet</span>
					{:else if dirty}
						<span class="text-xs text-muted-foreground">Unsaved changes</span>
					{/if}
					{#if canWrite}
						{#if formatKind(open)}
							<Button variant="outline" onclick={format} disabled={file?.loading}>
								<WandIcon />Format
							</Button>
						{/if}
						<Button onClickPromise={save} disabled={!unsaved}>Save</Button>
					{/if}
				</div>
				{#if file?.error}
					<p class="text-sm text-destructive" role="alert">
						{message(file.error, 'Could not open this file.')}
					</p>
				{:else if isNew || file?.current}
					{#key open}
						<CodeEditor
							bind:value={draft}
							filename={open}
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
				{naming?.kind === 'folder'
					? 'The path inside the server folder. The folder is kept once it holds a file.'
					: 'The path inside the server folder. A new folder in the path is made for you.'}
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
				<Field.Field data-invalid={nameError ? true : undefined}>
					<Field.Label for="config-path">Path</Field.Label>
					<Input
						id="config-path"
						bind:value={naming.value}
						class="font-mono"
						autocomplete="off"
						aria-invalid={nameError ? true : undefined}
					/>
					{#if nameError}<Field.Error>{nameError}</Field.Error>{/if}
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

<AlertDialog.Root bind:open={confirmDiscard}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard your changes?</AlertDialog.Title>
			<AlertDialog.Description>
				{isNew
					? 'This new file has not been saved yet.'
					: 'The edits to this file have not been saved.'}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={discard}>Discard</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
