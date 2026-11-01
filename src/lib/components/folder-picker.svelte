<script lang="ts">
	import FolderIcon from '@tabler/icons-svelte/icons/folder';
	import FolderPlusIcon from '@tabler/icons-svelte/icons/folder-plus';
	import { untrack } from 'svelte';

	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import {
		folderName,
		newFolderError,
		openableFolder,
		parentFolder,
		sortFolders
	} from '#lib/folder-picker.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A small file manager that shows only folders, to choose where things go. The folder being shown
	 * is the choice. A `..` row goes up, and a folder made here is only a name until the holder uses
	 * the choice, so nothing is written by closing it.
	 */
	let {
		folder = $bindable(''),
		list,
		exclude = () => false,
		rootLabel = 'server',
		class: className
	}: {
		/** The folder being shown, as a path from the top ('' is the top). */
		folder?: string;
		/** The folders directly inside a folder, as paths. May be slow; the picker shows a placeholder. */
		list: (folder: string) => string[] | Promise<string[]>;
		/** Folders that cannot be chosen, so they and everything inside are left out. */
		exclude?: (path: string) => boolean;
		/** What the top is called in the path shown. */
		rootLabel?: string;
		class?: string;
	} = $props();

	// the picker may open in a folder that cannot be chosen, such as inside one that is being moved
	untrack(() => {
		folder = openableFolder(folder, exclude);
	});

	// folders made here, which the server does not have yet
	let created = $state<string[]>([]);
	const isNew = (path: string) =>
		created.some((made) => path === made || path.startsWith(`${made}/`));

	const names = $derived(isNew(folder) ? [] : list(folder));

	// the names the folder holds, kept for checking a new one against
	let known = $state<string[]>([]);
	$effect(() => {
		const current = names;
		let live = true;
		Promise.resolve(current).then(
			(paths) => {
				if (live) known = paths.map(folderName);
			},
			() => {
				if (live) known = [];
			}
		);
		return () => {
			live = false;
		};
	});

	const madeHere = $derived(created.filter((made) => parentFolder(made) === folder));
	const siblings = $derived([...known, ...madeHere.map(folderName)]);

	let naming = $state<string | null>(null);
	const nameError = $derived(naming === null ? undefined : newFolderError(naming, siblings));

	function addFolder() {
		if (naming === null || nameError) return;
		const made = folder ? `${folder}/${naming.trim()}` : naming.trim();
		created.push(made);
		folder = made;
		naming = null;
	}

	const shown = (listed: string[]) =>
		sortFolders([...new Set([...listed, ...madeHere])].filter((path) => !exclude(path)));
</script>

{#snippet rows(listed: string[], failed = false)}
	{@const children = shown(listed)}
	<ul class="grid divide-y">
		{#if folder}
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-2 px-3 py-2 text-start font-mono text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
					onclick={() => (folder = parentFolder(folder))}
				>
					<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
					<span aria-hidden="true">..</span>
					<span class="sr-only">Up to {parentFolder(folder) || rootLabel}</span>
				</button>
			</li>
		{/if}
		{#each children as child (child)}
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-2 px-3 py-2 text-start font-mono text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
					onclick={() => (folder = child)}
				>
					<FolderIcon class="size-4 shrink-0 text-muted-foreground" />
					<span class="min-w-0 flex-1 truncate">{folderName(child)}</span>
					{#if isNew(child)}
						<span class="shrink-0 text-xs text-muted-foreground">New</span>
					{/if}
				</button>
			</li>
		{:else}
			<li class="px-3 py-2 text-sm text-muted-foreground" role="status">
				{failed ? 'Could not read this folder.' : 'No folders here.'}
			</li>
		{/each}
	</ul>
{/snippet}

<div class={cn('grid gap-2', className)}>
	<div class="flex items-center gap-2">
		<p class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={folder}>
			{rootLabel}{folder ? `/${folder}` : ''}
		</p>
		{#if naming === null}
			<Button variant="ghost" size="sm" onclick={() => (naming = '')}>
				<FolderPlusIcon />New folder
			</Button>
		{/if}
	</div>
	{#if naming !== null}
		<div class="grid gap-1.5">
			<div class="flex gap-2">
				<!-- not a form: the picker sits in dialogs, and Enter here must not submit them -->
				<Input
					bind:value={naming}
					class="font-mono"
					placeholder="Folder name, such as sodium"
					aria-label="Name of the new folder"
					aria-invalid={naming.trim() && nameError ? true : undefined}
					autocomplete="off"
					spellcheck="false"
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						addFolder();
					}}
				/>
				<Button variant="outline" disabled={!!nameError} onclick={addFolder}>Add</Button>
				<Button variant="ghost" onclick={() => (naming = null)}>Cancel</Button>
			</div>
			{#if naming.trim() && nameError}
				<p class="text-xs text-destructive" role="alert">{nameError}</p>
			{/if}
		</div>
	{/if}
	<div class="max-h-64 min-h-24 overflow-y-auto rounded-lg border">
		{#if names instanceof Promise}
			{#await names}
				<div class="grid gap-2 p-3">
					<Skeleton class="h-4 w-40" />
					<Skeleton class="h-4 w-32" />
				</div>
			{:then listed}
				{@render rows(listed)}
			{:catch}
				{@render rows([], true)}
			{/await}
		{:else}
			{@render rows(names)}
		{/if}
	</div>
</div>
