<script lang="ts">
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FileTextIcon from '@tabler/icons-svelte/icons/file-text';
	import FileZipIcon from '@tabler/icons-svelte/icons/file-zip';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import XIcon from '@tabler/icons-svelte/icons/x';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Attachment from '#lib/components/ui/attachment/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as FileDropZone from '#lib/components/ui/file-drop-zone/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import {
		batches,
		collectEntries,
		fromFileList,
		MAX_ITEMS,
		type FsEntry,
		type UploadItem
	} from '#lib/upload-entries.js';

	/**
	 * Pick or drop files (or a whole folder), review them as attachments, then send them. How they
	 * are sent is up to `upload`: it receives one batch at a time, so anything async works (here: a
	 * remote command). Per-file state shows on each attachment while the batches go out.
	 */
	let {
		upload,
		maxFileBytes,
		busy = $bindable(false),
		onDone,
		folders = true,
		noun = 'files'
	}: {
		upload: (batch: UploadItem[]) => Promise<void>;
		maxFileBytes: number;
		/** true while sending; lets a parent keep a dialog open */
		busy?: boolean;
		/** called once everything has been sent */
		onDone?: (count: number) => void;
		/** offer "Choose a folder" and accept dropped folders */
		folders?: boolean;
		noun?: string;
	} = $props();

	type Status = { state: Attachment.AttachmentState; message?: string };

	let queue = $state<UploadItem[]>([]);
	let status = $state<Record<string, Status>>({});
	let dragging = $state(false);
	let progress = $state({ done: 0, total: 0 });
	// the drop zone's own (hidden) file input, found by id so a button can open it
	const fileInputId = $props.id();
	let folderInput = $state<HTMLInputElement>();

	// image previews: object URLs, released when an item leaves the queue
	let previews = $state<Record<string, string>>({});
	const SHOWN = 100;
	const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

	const waiting = $derived(queue.filter((item) => status[item.path]?.state !== 'done'));
	const totalBytes = $derived(waiting.reduce((sum, item) => sum + item.file.size, 0));

	const size = (bytes: number) =>
		bytes < 1024
			? `${bytes} B`
			: bytes < 1024 ** 2
				? `${(bytes / 1024).toFixed(1)} KB`
				: bytes < 1024 ** 3
					? `${(bytes / 1024 ** 2).toFixed(1)} MB`
					: `${(bytes / 1024 ** 3).toFixed(2)} GB`;

	function dropPreview(path: string) {
		if (previews[path]) URL.revokeObjectURL(previews[path]);
		delete previews[path];
	}

	function clear() {
		for (const path of Object.keys(previews)) dropPreview(path);
		queue = [];
		status = {};
	}
	onDestroy(clear);

	/** Adds to the queue; a path already queued is replaced, matching what the server does. */
	function add(items: UploadItem[]) {
		const byPath: Record<string, UploadItem> = Object.fromEntries(
			queue.map((item) => [item.path, item])
		);
		for (const item of items) {
			if (item.file.size > maxFileBytes) {
				toast.error(`${item.path} is too large`, {
					description: `The limit is ${size(maxFileBytes)}.`
				});
				continue;
			}
			byPath[item.path] = item;
			status[item.path] = { state: 'idle' };
			dropPreview(item.path);
			if (item.file.type.startsWith('image/') && item.file.size <= PREVIEW_MAX_BYTES)
				previews[item.path] = URL.createObjectURL(item.file);
		}
		const next = Object.values(byPath);
		if (next.length > MAX_ITEMS) {
			toast.error(`That is more than ${MAX_ITEMS} ${noun}`, {
				description: 'Upload them in smaller groups.'
			});
			return;
		}
		queue = next;
	}

	function remove(path: string) {
		dropPreview(path);
		delete status[path];
		queue = queue.filter((item) => item.path !== path);
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		const transfer = event.dataTransfer;
		if (!transfer) return;
		// the entries must be taken synchronously: the list is emptied once this handler returns
		const entries = Array.from(transfer.items)
			.map((item) => item.webkitGetAsEntry?.())
			.filter((entry): entry is FileSystemEntry => !!entry);
		try {
			add(
				folders && entries.length
					? await collectEntries(entries as unknown as FsEntry[])
					: fromFileList(transfer.files)
			);
		} catch {
			toast.error('Could not read what was dropped');
		}
	}

	async function send() {
		const todo = waiting;
		if (!todo.length || busy) return;
		busy = true;
		progress = { done: 0, total: todo.length };
		try {
			for (const batch of batches(todo)) {
				for (const item of batch) status[item.path] = { state: 'uploading' };
				try {
					await upload(batch);
				} catch (e) {
					const message =
						(e as { body?: { message?: string } }).body?.message ?? 'The upload failed';
					for (const item of batch) status[item.path] = { state: 'error', message };
					toast.error(message);
					return;
				}
				for (const item of batch) status[item.path] = { state: 'done' };
				progress.done += batch.length;
			}
			const count = progress.total;
			clear();
			onDone?.(count);
		} finally {
			busy = false;
		}
	}

	const iconFor = (name: string) =>
		/\.(zip|jar|gz|tar|7z|rar)$/i.test(name)
			? FileZipIcon
			: /\.(txt|json|toml|ya?ml|cfg|conf|ini|properties|md|log|xml)$/i.test(name)
				? FileTextIcon
				: FileIcon;
</script>

<div class="grid gap-3">
	<!-- The root only supplies the hidden file input (opened by the buttons below). The zone itself is
	     a plain drop target: clicking it does nothing. -->
	<FileDropZone.Root
		id={fileInputId}
		disabled={busy}
		maxFileSize={maxFileBytes}
		onUpload={async (files) => add(fromFileList(files))}
		onFileRejected={({ file }) => toast.error(`${file.name} is too large`)}
	/>
	{#if folders}
		<input
			bind:this={folderInput}
			type="file"
			class="hidden"
			webkitdirectory
			multiple
			onchange={(e) => {
				add(fromFileList(e.currentTarget.files ?? []));
				e.currentTarget.value = '';
			}}
		/>
	{/if}

	{#snippet pickers(compact: boolean)}
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={busy}
			onclick={() => document.getElementById(fileInputId)?.click()}
		>
			<FileIcon />{compact ? 'Add' : 'Choose'}
			{noun}
		</Button>
		{#if folders}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={busy}
				onclick={() => folderInput?.click()}
			>
				<FolderIcon />{compact ? 'Add' : 'Choose'} a folder
			</Button>
		{/if}
	{/snippet}

	<div
		role="presentation"
		class="flex min-h-44 flex-col rounded-lg border border-dashed transition-colors {dragging
			? 'border-primary bg-accent/40'
			: ''}"
		ondragenter={() => (dragging = true)}
		ondragover={(e: DragEvent) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={onDrop}
	>
		{#if !queue.length}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<UploadIcon class="size-7 text-muted-foreground" />
				<span class="font-medium">
					{folders ? `Drop ${noun} or a folder here` : `Drop ${noun} here`}
				</span>
				<span
					class="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground"
				>
					or
					{@render pickers(false)}
				</span>
			</div>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-2 border-b p-2 ps-3">
				<span class="text-sm">
					<span class="font-medium">{waiting.length} to upload</span>
					<span class="text-muted-foreground"> · {size(totalBytes)}</span>
				</span>
				<span class="flex flex-wrap gap-2">{@render pickers(true)}</span>
			</div>
			<div class="grid max-h-56 gap-1.5 overflow-y-auto p-2">
				{#each queue.slice(0, SHOWN) as item (item.path)}
					{@const current = status[item.path] ?? { state: 'idle' }}
					{@const Icon = iconFor(item.path)}
					<Attachment.Root state={current.state} size="sm" class="w-full">
						<Attachment.Media variant={previews[item.path] ? 'image' : 'icon'}>
							{#if previews[item.path]}
								<img src={previews[item.path]} alt="" />
							{:else if current.state === 'uploading'}
								<Spinner />
							{:else}
								<Icon />
							{/if}
						</Attachment.Media>
						<Attachment.Content>
							<Attachment.Title class="truncate" title={item.path}>{item.path}</Attachment.Title>
							<Attachment.Description
								class={current.state === 'error' ? 'text-destructive' : undefined}
							>
								{current.state === 'error'
									? (current.message ?? 'Failed')
									: current.state === 'done'
										? 'Uploaded'
										: size(item.file.size)}
							</Attachment.Description>
						</Attachment.Content>
						<Attachment.Actions>
							<Attachment.Action
								aria-label="Remove {item.path}"
								disabled={busy}
								onclick={() => remove(item.path)}
							>
								<XIcon />
							</Attachment.Action>
						</Attachment.Actions>
					</Attachment.Root>
				{/each}
				{#if queue.length > SHOWN}
					<p class="px-1 text-xs text-muted-foreground">and {queue.length - SHOWN} more {noun}</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if busy}
		<div class="grid gap-1">
			<Progress value={progress.done} max={Math.max(progress.total, 1)} />
			<p class="text-xs text-muted-foreground">
				Uploading {progress.done} of {progress.total}…
			</p>
		</div>
	{/if}

	<Button type="button" disabled={!waiting.length} loading={busy} onclick={send}>
		Upload {waiting.length || ''}
	</Button>
</div>
