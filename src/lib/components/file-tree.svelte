<script lang="ts" generics="T extends { path: string }">
	import type { Snippet } from 'svelte';

	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';

	import type { FolderNode, TreeNode } from '#lib/file-tree.js';

	import * as Collapsible from '#lib/components/ui/collapsible/index.js';

	let {
		nodes,
		selected = null,
		selectable = () => true,
		unselectableTitle,
		status,
		onselect,
		trailing,
		folderTrailing,
		open = true
	}: {
		/** From `buildFileTree`. */
		nodes: TreeNode<T>[];
		/** The path of the file shown as chosen. */
		selected?: string | null;
		/** A file that is not selectable is listed but cannot be picked. */
		selectable?: (item: T) => boolean;
		/** Says why, as a tooltip on an unselectable file's name. */
		unselectableTitle?: string;
		/** A coloured dot after a file's name, with what it means (also read out to screen readers). */
		status?: (item: T) => { tone: 'info' | 'warning'; label: string } | undefined;
		onselect?: (item: T) => void;
		/** What follows a file's name: a size, action buttons. */
		trailing?: Snippet<[T]>;
		folderTrailing?: Snippet<[FolderNode<T>]>;
		/** Whether the folders start open. */
		open?: boolean;
	} = $props();
</script>

{#snippet branch(list: TreeNode<T>[])}
	{#each list as node (node.path)}
		{#if node.kind === 'folder'}
			<Collapsible.Root {open}>
				<div class="flex items-center gap-1 rounded-md hover:bg-accent/50">
					<Collapsible.Trigger
						class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-start text-sm [&[data-state=open]>svg:first-child]:rotate-90"
					>
						<ChevronRightIcon class="size-3.5 shrink-0 transition-transform" />
						<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
						<span class="truncate font-mono">{node.name}</span>
					</Collapsible.Trigger>
					{@render folderTrailing?.(node)}
				</div>
				<Collapsible.Content>
					<div class="ms-4 grid gap-0.5 border-s ps-1.5">{@render branch(node.children)}</div>
				</Collapsible.Content>
			</Collapsible.Root>
		{:else}
			{@const mark = status?.(node.item)}
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
				{#if mark}
					<span
						class="size-2 shrink-0 rounded-full {mark.tone === 'info' ? 'bg-info' : 'bg-warning'}"
						title={mark.label}
					></span>
					<span class="sr-only">{mark.label}</span>
				{/if}
				{@render trailing?.(node.item)}
			</div>
		{/if}
	{/each}
{/snippet}

<div class="grid gap-0.5">{@render branch(nodes)}</div>
