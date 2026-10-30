<script lang="ts">
	import type { FlexiWidgetController } from '@flexiboards/svelte';
	import CrownIcon from '@tabler/icons-svelte/icons/crown';
	import LockIcon from '@tabler/icons-svelte/icons/lock';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import * as SortableList from '#lib/components/flexi-sortable-list/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import type { RoleLock } from '#lib/role-lock.js';
	import { cn } from '#lib/utils.js';

	interface Role {
		id: number;
		name: string;
		memberCount: number;
		lock: RoleLock | null;
	}

	let {
		class: className,
		roles,
		selectedId = $bindable(),
		unsavedIds,
		canWrite,
		onreorder,
		oncreate
	}: {
		class?: string;
		/** Highest rank first. */
		roles: Role[];
		selectedId: number | undefined;
		unsavedIds: ReadonlySet<number>;
		canWrite: boolean;
		/** Every role id, highest first, after a drag. */
		onreorder: (ids: number[]) => void;
		oncreate: () => void;
	} = $props();

	let search = $state('');
	const term = $derived(search.trim().toLowerCase());
	const filtered = $derived(term ? roles.filter((r) => r.name.toLowerCase().includes(term)) : []);

	// Roles at or above your own rank can never move, so they sit above the drag area and nothing
	// can be dropped over them.
	const pinned = $derived(canWrite ? roles.filter((r) => r.lock === 'rank') : roles);
	const sortable = $derived(canWrite ? roles.filter((r) => r.lock !== 'rank') : []);
	// The board owns its order once mounted, so redraw it whenever the server's order changes.
	const boardKey = $derived(sortable.map((r) => r.id).join());

	function handleReorder(ids: string[]) {
		onreorder([...pinned.map((r) => r.id), ...ids.map(Number)]);
	}
</script>

{#snippet row(role: Role)}
	<button
		type="button"
		class="flex min-w-0 flex-1 flex-col items-start rounded-md py-1.5 pe-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
		aria-current={role.id === selectedId ? 'true' : undefined}
		onclick={() => (selectedId = role.id)}
	>
		<span class="flex w-full items-center gap-2">
			<span class={cn('truncate', role.id === selectedId && 'font-semibold')}>{role.name}</span>
			{#if unsavedIds.has(role.id)}
				<span class="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes"></span>
				<span class="sr-only">(unsaved changes)</span>
			{/if}
		</span>
		<span class="text-xs text-muted-foreground">
			{role.memberCount}
			{role.memberCount === 1 ? 'person' : 'people'}
		</span>
	</button>
{/snippet}

{#snippet lockSlot()}
	<span class="flex size-7 shrink-0 items-center justify-center text-muted-foreground/60">
		<LockIcon class="size-3.5" aria-hidden="true" />
	</span>
{/snippet}

{#snippet staticRow(role: Role, locked: boolean)}
	<li
		class={cn(
			'flex min-w-0 items-center gap-1 rounded-lg text-sm transition-colors',
			role.id === selectedId ? 'bg-accent' : 'hover:bg-accent/60',
			!locked && 'ps-2'
		)}
	>
		{#if locked}{@render lockSlot()}{/if}
		{@render row(role)}
	</li>
{/snippet}

<div class={cn('flex flex-col rounded-xl border bg-card', className)}>
	<div class="flex flex-col gap-3 border-b p-3">
		<div class="flex items-center justify-between gap-2">
			<p class="text-xs text-muted-foreground">
				{roles.length}
				{roles.length === 1 ? 'role' : 'roles'}
			</p>
			{#if canWrite}
				<Button size="sm" onclick={oncreate}>
					<PlusIcon data-icon="inline-start" />
					New role
				</Button>
			{/if}
		</div>
		<InputGroup.Root>
			<InputGroup.Addon>
				<SearchIcon />
			</InputGroup.Addon>
			<InputGroup.Input bind:value={search} placeholder="Search roles" aria-label="Search roles" />
		</InputGroup.Root>
	</div>

	<div class="flex flex-col gap-1 p-2">
		<div class="flex items-center gap-1 rounded-lg text-sm" aria-label="Owner">
			<span class="flex size-7 shrink-0 items-center justify-center text-primary">
				<CrownIcon class="size-3.5" aria-hidden="true" />
			</span>
			<div class="flex flex-col py-1.5">
				<span>Owner</span>
				<span class="text-xs text-muted-foreground">Outranks every role</span>
			</div>
		</div>

		{#if term}
			{#if filtered.length}
				<ul class="flex flex-col gap-1">
					{#each filtered as role (role.id)}
						{@render staticRow(role, false)}
					{/each}
				</ul>
			{:else}
				<p class="px-2 py-3 text-xs text-muted-foreground">No roles match "{search.trim()}".</p>
			{/if}
			{#if canWrite}
				<p class="px-2 pt-2 text-xs text-muted-foreground">Clear the search to reorder.</p>
			{/if}
		{:else}
			{#if pinned.length}
				<ul class="flex flex-col gap-1">
					{#each pinned as role (role.id)}
						{@render staticRow(role, canWrite)}
					{/each}
				</ul>
			{/if}

			{#if sortable.length}
				{#key boardKey}
					<SortableList.Root class="gap-1" onreorder={handleReorder}>
						{#each sortable as role (role.id)}
							<SortableList.Item
								id={String(role.id)}
								draggability={role.lock ? 'none' : 'full'}
								class={(widget: FlexiWidgetController) =>
									cn(
										'transition-colors',
										!widget.isGrabbed &&
											(role.id === selectedId ? 'bg-accent' : 'hover:bg-accent/60')
									)}
							>
								{#if role.lock}
									{@render lockSlot()}
								{:else}
									<SortableList.Grabber class="size-7" size={14} label="Move {role.name}" />
								{/if}
								{@render row(role)}
							</SortableList.Item>
						{/each}
					</SortableList.Root>
				{/key}
			{/if}

			{#if roles.length === 0}
				<p class="px-2 py-3 text-xs/relaxed text-muted-foreground">
					No roles yet. {canWrite ? 'Create one to start giving people access.' : ''}
				</p>
			{/if}
		{/if}
	</div>
</div>
