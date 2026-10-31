<script lang="ts" generics="T extends { path: string }">
	import type { Snippet } from 'svelte';

	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';

	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { movedPath, TREE_DRAG_TYPE, type FolderNode, type TreeNode } from '#lib/file-tree.js';

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
		onmove,
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
		/**
		 * A file or folder was dragged onto a folder (or onto a file, meaning the folder it is in). The
		 * root is not a row here: whoever holds the tree takes drops on the space around it.
		 * Without this, rows cannot be dragged.
		 */
		onmove?: (from: string, folder: string) => void;
		/** What follows a file's name: a size, action buttons. */
		trailing?: Snippet<[T]>;
		folderTrailing?: Snippet<[FolderNode<T>]>;
		/** Whether the folders start open. */
		open?: boolean;
	} = $props();

	let dropOn = $state<string | null>(null);
	// the path being dragged: a drop target cannot read the data until the drop, but needs to know now
	let dragged = $state<string | null>(null);

	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
	const isTreeDrag = (event: DragEvent) =>
		event.dataTransfer?.types.includes(TREE_DRAG_TYPE) ?? false;
	const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

	function dragStart(event: DragEvent, path: string) {
		if (!event.dataTransfer) return;
		event.dataTransfer.setData(TREE_DRAG_TYPE, path);
		event.dataTransfer.effectAllowed = 'move';
		dragged = path;
	}

	function dragEnd() {
		dragged = null;
		dropOn = null;
	}

	/** Takes a dragged tree item hovering over `folder`; false when it is not one. */
	function dragOverFolder(event: DragEvent, folder: string, highlight: string | null) {
		if (!onmove || !isTreeDrag(event)) return false;
		// stopped either way: the space behind the tree would read it as a drop on the root
		event.stopPropagation();
		if (dragged === null || movedPath(dragged, folder) === null) return true;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropOn = highlight;
		return true;
	}

	/** Takes a dragged tree item dropped on `folder`; false when it is not one. */
	function dropOnFolder(event: DragEvent, folder: string) {
		if (!onmove || !isTreeDrag(event)) return false;
		event.stopPropagation();
		const from = dragged;
		dragEnd();
		if (from !== null && movedPath(from, folder) !== null) {
			event.preventDefault();
			onmove(from, folder);
		}
		return true;
	}
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
					data-tree-row
					draggable={onmove ? 'true' : undefined}
					ondragstart={(event) => dragStart(event, node.path)}
					ondragend={dragEnd}
					class="flex items-center gap-1 rounded-md hover:bg-accent/50 {selectedFolder === node.path
						? 'bg-accent'
						: ''} {dropOn === node.path ? 'bg-accent ring-2 ring-ring/50' : ''}"
					ondragover={(event) => {
						if (dragOverFolder(event, node.path, node.path)) return;
						if (!ondropfiles || !hasFiles(event)) return;
						event.preventDefault();
						event.stopPropagation();
						dropOn = node.path;
					}}
					ondragleave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node)) dropOn = null;
					}}
					ondrop={(event) => {
						if (dropOnFolder(event, node.path)) return;
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
						<span class="truncate font-mono" title={node.name}>{node.name}</span>
					</Collapsible.Trigger>
					{@render dot(folderStatus?.(node))}
					{@render folderTrailing?.(node)}
				</div>
				<Collapsible.Content>
					<div class="ms-4 grid grid-cols-[minmax(0,1fr)] gap-0.5 border-s ps-1.5">
						{@render branch(node.children)}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{:else}
			<div
				role="presentation"
				data-tree-row
				draggable={onmove ? 'true' : undefined}
				ondragstart={(event) => dragStart(event, node.path)}
				ondragend={dragEnd}
				ondragover={(event) => dragOverFolder(event, dirOf(node.path), dirOf(node.path) || null)}
				ondragleave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node)) dropOn = null;
				}}
				ondrop={(event) => dropOnFolder(event, dirOf(node.path))}
				class="flex items-center gap-1 rounded-md ps-2 {selected === node.path ? 'bg-accent' : ''}"
			>
				<FileIcon class="size-4 shrink-0 text-muted-foreground" />
				{#if selectable(node.item)}
					<button
						type="button"
						class="min-w-0 flex-1 truncate py-1.5 ps-1 text-start font-mono text-sm"
						title={node.name}
						aria-current={selected === node.path}
						onclick={() => onselect?.(node.item)}
					>
						{node.name}
					</button>
				{:else}
					<span
						class="min-w-0 flex-1 truncate py-1.5 ps-1 font-mono text-sm text-muted-foreground"
						title={unselectableTitle ? `${node.name} (${unselectableTitle})` : node.name}
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

<!-- minmax(0, 1fr): a grid column otherwise grows to its longest name instead of truncating it -->
<div class="grid grid-cols-[minmax(0,1fr)] gap-0.5">{@render branch(nodes)}</div>
