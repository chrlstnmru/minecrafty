<script lang="ts" generics="T extends { path: string }">
	import type { Snippet } from 'svelte';

	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';

	import type { FolderNode, TreeNode } from '#lib/file-tree.js';

	import * as Collapsible from '#lib/components/ui/collapsible/index.js';

	type Status = { tone: 'info' | 'warning'; label: string };

	let {
		nodes,
		selected = null,
		selectedFolder = null,
		selectable = () => true,
		unselectableTitle,
		status,
		folderStatus,
		onselect,
		onselectfolder,
		ondropfiles,
		trailing,
		folderTrailing,
		open = true
	}: {
		/** From `buildFileTree`. */
		nodes: TreeNode<T>[];
		/** The path of the file shown as chosen. */
		selected?: string | null;
		/** The path of the folder shown as chosen, where new things would go. */
		selectedFolder?: string | null;
		/** A file that is not selectable is listed but cannot be picked. */
		selectable?: (item: T) => boolean;
		/** Says why, as a tooltip on an unselectable file's name. */
		unselectableTitle?: string;
		/** A coloured dot after a name, with what it means (also read out to screen readers). */
		status?: (item: T) => Status | undefined;
		folderStatus?: (folder: FolderNode<T>) => Status | undefined;
		onselect?: (item: T) => void;
		/** A folder was clicked (it also opens or closes). */
		onselectfolder?: (path: string) => void;
		/** Files from the desktop were dropped on a folder. Without this, folders are not drop targets. */
		ondropfiles?: (folder: string, transfer: DataTransfer) => void;
		/** What follows a file's name: a size, action buttons. */
		trailing?: Snippet<[T]>;
		folderTrailing?: Snippet<[FolderNode<T>]>;
		/** Whether the folders start open. */
		open?: boolean;
	} = $props();

	let dropOn = $state<string | null>(null);

	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
</script>

{#snippet dot(mark: Status | undefined)}
	{#if mark}
		<span
			class="me-2 size-2 shrink-0 rounded-full {mark.tone === 'info' ? 'bg-info' : 'bg-warning'}"
			title={mark.label}
		></span>
		<span class="sr-only">{mark.label}</span>
	{/if}
{/snippet}

{#snippet branch(list: TreeNode<T>[])}
	{#each list as node (node.path)}
		{#if node.kind === 'folder'}
			<Collapsible.Root {open}>
				<div
					role="presentation"
					class="flex items-center gap-1 rounded-md hover:bg-accent/50 {selectedFolder === node.path
						? 'bg-accent'
						: ''} {dropOn === node.path ? 'bg-accent ring-2 ring-ring/50' : ''}"
					ondragover={(event) => {
						if (!ondropfiles || !hasFiles(event)) return;
						event.preventDefault();
						event.stopPropagation();
						dropOn = node.path;
					}}
					ondragleave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node)) dropOn = null;
					}}
					ondrop={(event) => {
						if (!ondropfiles || !event.dataTransfer || !hasFiles(event)) return;
						event.preventDefault();
						event.stopPropagation();
						dropOn = null;
						ondropfiles(node.path, event.dataTransfer);
					}}
				>
					<Collapsible.Trigger
						class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-start text-sm [&[data-state=open]>svg:first-child]:rotate-90"
						onclick={() => onselectfolder?.(node.path)}
					>
						<ChevronRightIcon class="size-3.5 shrink-0 transition-transform" />
						<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
						<span class="truncate font-mono">{node.name}</span>
					</Collapsible.Trigger>
					{@render dot(folderStatus?.(node))}
					{@render folderTrailing?.(node)}
				</div>
				<Collapsible.Content>
					<div class="ms-4 grid gap-0.5 border-s ps-1.5">{@render branch(node.children)}</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{:else}
			<div
				class="flex items-center gap-1 rounded-md ps-2 {selected === node.path ? 'bg-accent' : ''}"
			>
				<FileIcon class="size-4 shrink-0 text-muted-foreground" />
				{#if selectable(node.item)}
					<button
						type="button"
						class="min-w-0 flex-1 truncate py-1.5 ps-1 text-start font-mono text-sm"
						aria-current={selected === node.path}
						onclick={() => onselect?.(node.item)}
					>
						{node.name}
					</button>
				{:else}
					<span
						class="min-w-0 flex-1 truncate py-1.5 ps-1 font-mono text-sm text-muted-foreground"
						title={unselectableTitle}
					>
						{node.name}
					</span>
				{/if}
				{@render dot(status?.(node.item))}
				{@render trailing?.(node.item)}
			</div>
		{/if}
	{/each}
{/snippet}

<div class="grid gap-0.5">{@render branch(nodes)}</div>
