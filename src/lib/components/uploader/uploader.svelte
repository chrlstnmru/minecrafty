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
	import { SMALL_FILE_BYTES } from '#lib/upload-limits.js';

	/**
	 * Pick or drop files (or a whole folder), review them as attachments, then send them. How they
	 * are sent is up to `upload`: it receives one batch at a time, so anything async works (here: a
	 * remote command). Per-file state shows on each attachment while the batches go out.
	 */
	let {
		upload,
		uploadLarge,
		discard,
		maxFileBytes,
		smallFileBytes = SMALL_FILE_BYTES,
		busy = $bindable(false),
		onDone,
		folders = true,
		noun = 'files'
	}: {
		/** sends a batch of small files */
		upload: (batch: UploadItem[]) => Promise<void>;
		/**
		 * Sends one file bigger than `smallFileBytes`, reporting bytes as they are acknowledged. It
		 * should be resumable: calling it again for a file that failed picks up where it stopped.
		 * Without it, every file goes through `upload`.
		 */
		uploadLarge?: (
			item: UploadItem,
			onBytes: (sent: number, total: number) => void,
			signal: AbortSignal
		) => Promise<void>;
		/** a file left the queue (removed, or the uploader closed): drop whatever was sent of it */
		discard?: (item: UploadItem) => void;
		maxFileBytes: number;
		smallFileBytes?: number;
		/** true while sending; lets a parent keep a dialog open */
		busy?: boolean;
		/** called once everything has been sent */
		onDone?: (count: number) => void;
		/** offer "Choose a folder" and accept dropped folders */
		folders?: boolean;
		noun?: string;
	} = $props();

	type Status = { state: Attachment.AttachmentState; message?: string; sent?: number };

	let queue = $state<UploadItem[]>([]);
	let status = $state<Record<string, Status>>({});
	let dragging = $state(false);
	let progress = $state({ bytes: 0, totalBytes: 0, files: 0, totalFiles: 0 });
	let controller: AbortController | undefined;
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
	let finished = false;
	onDestroy(() => {
		controller?.abort();
		if (!finished) for (const item of queue) if (isLarge(item)) discard?.(item);
		clear();
	});

	const isLarge = (item: UploadItem) => !!uploadLarge && item.file.size > smallFileBytes;

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
		const item = queue.find((i) => i.path === path);
		if (item && isLarge(item)) discard?.(item);
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
		controller = new AbortController();
		const { signal } = controller;
		const small = todo.filter((item) => !isLarge(item));
		const large = todo.filter(isLarge);
		progress = {
			bytes: 0,
			totalBytes: todo.reduce((sum, item) => sum + item.file.size, 0),
			files: 0,
			totalFiles: todo.length
		};
		const finish = (item: UploadItem) => {
			status[item.path] = { state: 'done' };
			progress.bytes += item.file.size;
			progress.files++;
		};
		const fail = (items: UploadItem[], e: unknown) => {
			const message =
				(e as { body?: { message?: string } }).body?.message ??
				(e as Error).message ??
				'The upload failed';
			for (const item of items) status[item.path] = { state: 'error', message };
			toast.error(message);
		};

		try {
			for (const batch of batches(small)) {
				if (signal.aborted) break;
				for (const item of batch) status[item.path] = { state: 'uploading' };
				try {
					await upload(batch);
				} catch (e) {
					fail(batch, e);
					return;
				}
				for (const item of batch) finish(item);
			}
			for (const item of large) {
				if (signal.aborted) break;
				status[item.path] = { state: 'uploading', sent: 0 };
				const base = progress.bytes;
				try {
					await uploadLarge!(
						item,
						(sent) => {
							status[item.path] = { state: 'uploading', sent };
							progress.bytes = base + sent;
						},
						signal
					);
				} catch (e) {
					if (signal.aborted) break;
					fail([item], e);
					return;
				}
				progress.bytes = base;
				finish(item);
			}

			if (signal.aborted) {
				// what was sent stays sent; the rest goes back to waiting
				for (const item of todo)
					if (status[item.path]?.state !== 'done') status[item.path] = { state: 'idle' };
				toast.info('Upload cancelled');
				return;
			}
			const count = progress.totalFiles;
			// with a parent that closes us, keep the list as is so it does not collapse mid-animation
			if (onDone) {
				finished = true;
				onDone(count);
			} else clear();
		} finally {
			controller = undefined;
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
										: current.state === 'uploading' && isLarge(item)
											? `${size(current.sent ?? 0)} of ${size(item.file.size)}`
											: size(item.file.size)}
							</Attachment.Description>
							{#if current.state === 'uploading' && isLarge(item)}
								<Progress
									class="mt-1 h-1"
									value={current.sent ?? 0}
									max={Math.max(item.file.size, 1)}
								/>
							{/if}
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
			<Progress value={progress.bytes} max={Math.max(progress.totalBytes, 1)} />
			<p class="text-xs text-muted-foreground">
				Uploading {progress.files} of {progress.totalFiles}
				{progress.totalFiles === 1 ? 'file' : 'files'} · {size(progress.bytes)} of {size(
					progress.totalBytes
				)}
			</p>
		</div>
	{/if}

	<div class="flex gap-2">
		<Button type="button" class="flex-1" disabled={!waiting.length} loading={busy} onclick={send}>
			Upload {waiting.length || ''}
		</Button>
		{#if busy}
			<Button type="button" variant="outline" onclick={() => controller?.abort()}>Cancel</Button>
		{/if}
	</div>
</div>
