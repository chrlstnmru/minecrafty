<script lang="ts" generics="T extends { path: string }">
	import type { Snippet } from 'svelte';

	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import FileIcon from '@tabler/icons-svelte/icons/file';
	import FolderIcon from '@tabler/icons-svelte/icons/folder';

	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { DragMove } from '#lib/drag-move.svelte.js';
	import { nodeState, toggleNode, type FolderNode, type TreeNode } from '#lib/file-tree.js';

	type Status = { tone: 'info' | 'warning' | 'danger'; label: string };

	let {
		nodes,
		selected = null,
		selectedFolder = null,
		selectable = () => true,
		unselectableTitle,
		nameClass,
		dragDisabled,
		status,
		folderStatus,
		onselect,
		onselectfolder,
		ondropfiles,
		onmove,
		selection,
		onselection,
		checkable,
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
		unselectableTitle?: string | ((item: T) => string | undefined);
		/** Classes for a file's name, such as a strikethrough for one waiting to be deleted. */
		nameClass?: (item: T) => string | undefined;
		/** Rows that cannot be dragged (with `onmove` on, every other row can). */
		dragDisabled?: (item: T) => boolean;
		/** A coloured dot after a name, with what it means (also read out to screen readers). */
		status?: (item: T) => Status | undefined;
		folderStatus?: (folder: FolderNode<T>) => Status | undefined;
		onselect?: (item: T) => void;
		/** A folder was clicked (it also opens or closes). */
		onselectfolder?: (path: string) => void;
		/** Files from the desktop were dropped on a folder. Without this, folders are not drop targets. */
		ondropfiles?: (folder: string, transfer: DataTransfer) => void;
		/**
		 * Files or folders were dragged onto a folder (or onto a file, meaning the folder it is in).
		 * Dragging a row that is chosen carries everything chosen (the top-level paths); any other row
		 * goes alone. The root is not a row here: whoever holds the tree takes drops on the space
		 * around it. Without this, rows cannot be dragged.
		 */
		onmove?: (from: string[], folder: string) => void;
		/**
		 * The paths chosen with the checkboxes, files and folders (a folder chosen with all it holds).
		 * A checkbox shows in place of a row's icon on hover and, once anything is chosen, on every
		 * row; on a touch screen a long press chooses a row. Without `onselection` there are none.
		 */
		selection?: ReadonlySet<string>;
		onselection?: (next: Set<string>) => void;
		/** Rows that cannot be chosen get no checkbox. */
		checkable?: (path: string) => boolean;
		/** What follows a file's name: a size, action buttons. */
		trailing?: Snippet<[T]>;
		folderTrailing?: Snippet<[FolderNode<T>]>;
		/** Whether the folders start open. */
		open?: boolean;
	} = $props();

	const selecting = $derived((selection?.size ?? 0) > 0);
	const toggle = (node: TreeNode<T>, on: boolean) =>
		onselection?.(toggleNode(selection ?? new Set(), node, on));

	// a long press on a touch screen chooses the row; the click that ends it must not also open it
	let pressTimer: ReturnType<typeof setTimeout> | undefined;
	let pressedAt = { x: 0, y: 0 };
	let swallowClick = false;

	function pressStart(event: PointerEvent, node: TreeNode<T>) {
		swallowClick = false;
		if (!onselection || event.pointerType !== 'touch' || checkable?.(node.path) === false) return;
		pressedAt = { x: event.clientX, y: event.clientY };
		clearTimeout(pressTimer);
		pressTimer = setTimeout(() => {
			swallowClick = true;
			toggle(node, true);
			navigator.vibrate?.(10);
		}, 500);
	}

	function pressMove(event: PointerEvent) {
		if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 10)
			clearTimeout(pressTimer);
	}

	const pressEnd = () => clearTimeout(pressTimer);

	function swallow(event: Event) {
		if (!swallowClick) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.type === 'click') swallowClick = false;
	}
	const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
	const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

	const drag = new DragMove({
		onmove: () => onmove,
		onend: () => {
			// pressing a row focused its checkbox; a drag should not leave it showing
			const focused = document.activeElement;
			if (focused instanceof HTMLElement && focused.closest('[data-tree-row]')) focused.blur();
		}
	});
</script>

{#snippet dot(mark: Status | undefined)}
	{#if mark}
		<span
			class="me-2 size-2 shrink-0 rounded-full {mark.tone === 'info'
				? 'bg-info'
				: mark.tone === 'warning'
					? 'bg-warning'
					: 'bg-destructive'}"
			title={mark.label}
		></span>
		<span class="sr-only">{mark.label}</span>
	{/if}
{/snippet}

{#snippet lead(node: TreeNode<T>)}
	{@const state =
		onselection && checkable?.(node.path) !== false
			? nodeState(node, selection ?? new Set())
			: undefined}
	<span class="grid size-5 shrink-0 place-items-center *:col-start-1 *:row-start-1">
		{#if node.kind === 'folder'}
			<FolderIcon
				class="size-4 text-muted-foreground {state !== undefined
					? `group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0 ${selecting ? 'opacity-0' : ''}`
					: ''}"
			/>
		{:else}
			<FileIcon
				class="size-4 text-muted-foreground {state !== undefined
					? `group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0 ${selecting ? 'opacity-0' : ''}`
					: ''}"
			/>
		{/if}
		{#if state !== undefined}
			<Checkbox
				checked={state === true}
				indeterminate={state === 'mixed'}
				aria-label="Choose {node.name}"
				onCheckedChange={(on) => toggle(node, on)}
				class="opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 after:-inset-x-0.5 after:-inset-y-1 {selecting
					? 'opacity-100'
					: 'pointer-coarse:pointer-events-none'}"
			/>
		{/if}
	</span>
{/snippet}

{#snippet branch(list: TreeNode<T>[])}
	{#each list as node (node.path)}
		{#if node.kind === 'folder'}
			<Collapsible.Root {open}>
				<div
					role="presentation"
					data-tree-row
					draggable={onmove ? 'true' : undefined}
					ondragstart={(event) => drag.start(event, node.path, selection)}
					ondragend={() => drag.end()}
					onpointerdown={(event) => pressStart(event, node)}
					onpointermove={pressMove}
					onpointerup={pressEnd}
					onpointercancel={pressEnd}
					oncontextmenu={swallow}
					onclickcapture={swallow}
					class="group/row flex items-center gap-1 rounded-md hover:bg-accent/50 {onselection
						? 'select-none'
						: ''} {selectedFolder === node.path ? 'bg-accent' : ''} {drag.target === node.path
						? 'bg-accent ring-2 ring-ring/50'
						: ''}"
					ondragover={(event) => {
						if (drag.over(event, node.path)) return;
						if (!ondropfiles || !hasFiles(event)) return;
						event.preventDefault();
						event.stopPropagation();
						drag.target = node.path;
					}}
					ondragleave={(event) => drag.leave(event)}
					ondrop={(event) => {
						if (drag.drop(event, node.path)) return;
						if (!ondropfiles || !event.dataTransfer || !hasFiles(event)) return;
						event.preventDefault();
						event.stopPropagation();
						drag.target = null;
						ondropfiles(node.path, event.dataTransfer);
					}}
				>
					<Collapsible.Trigger
						class="flex shrink-0 items-center py-1.5 ps-2 [&[data-state=open]>svg]:rotate-90"
						aria-label="Open or close {node.name}"
						onclick={() => onselectfolder?.(node.path)}
					>
						<ChevronRightIcon class="size-3.5 shrink-0 transition-transform" />
					</Collapsible.Trigger>
					{@render lead(node)}
					<Collapsible.Trigger
						class="min-w-0 flex-1 py-1.5 text-start text-sm"
						onclick={() => onselectfolder?.(node.path)}
					>
						<span class="block truncate font-mono" title={node.name}>{node.name}</span>
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
				draggable={onmove && !dragDisabled?.(node.item) ? 'true' : undefined}
				ondragstart={(event) => drag.start(event, node.path, selection)}
				ondragend={() => drag.end()}
				onpointerdown={(event) => pressStart(event, node)}
				onpointermove={pressMove}
				onpointerup={pressEnd}
				onpointercancel={pressEnd}
				oncontextmenu={swallow}
				onclickcapture={swallow}
				ondragover={(event) => drag.over(event, dirOf(node.path), dirOf(node.path) || null)}
				ondragleave={(event) => drag.leave(event)}
				ondrop={(event) => drag.drop(event, dirOf(node.path))}
				class="group/row flex items-center gap-1 rounded-md ps-2 {onselection
					? 'select-none'
					: ''} {selected === node.path ? 'bg-accent' : ''}"
			>
				{@render lead(node)}
				{#if selectable(node.item)}
					<button
						type="button"
						class="min-w-0 flex-1 truncate py-1.5 ps-1 text-start font-mono text-sm {nameClass?.(
							node.item
						) ?? ''}"
						title={node.name}
						aria-current={selected === node.path}
						onclick={() => onselect?.(node.item)}
					>
						{node.name}
					</button>
				{:else}
					<span
						class="min-w-0 flex-1 truncate py-1.5 ps-1 font-mono text-sm text-muted-foreground {nameClass?.(
							node.item
						) ?? ''}"
						title={(() => {
							const why =
								typeof unselectableTitle === 'function'
									? unselectableTitle(node.item)
									: unselectableTitle;
							return why ? `${node.name} (${why})` : node.name;
						})()}
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
