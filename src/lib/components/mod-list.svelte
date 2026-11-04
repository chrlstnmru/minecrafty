<!-- The installed mods of an instance or a pack: filter, where each runs, versions and the rare actions. -->
<script lang="ts">
	import ArrowRightIcon from '@tabler/icons-svelte/icons/arrow-right';
	import DotsIcon from '@tabler/icons-svelte/icons/dots';
	import FilterIcon from '@tabler/icons-svelte/icons/filter';
	import PackageOffIcon from '@tabler/icons-svelte/icons/package-off';
	import SearchOffIcon from '@tabler/icons-svelte/icons/search-off';

	import SideTags from '#lib/components/side-tags.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import {
		MOD_FILTERS,
		countByFilter,
		filterMods,
		reason,
		type ModListItem
	} from '#lib/mod-list.js';
	import { UrlParam } from '#lib/url-param.svelte.js';

	let {
		items,
		noun,
		onToggle,
		onVersions,
		onUpdate,
		onUpdateAll,
		onRemove,
		onBrowse,
		filterable = true
	}: {
		items: ModListItem[];
		noun: string;
		/** shows a switch on each row; for an instance, where a jar can be turned off */
		onToggle?: (item: ModListItem, enabled: boolean) => Promise<void>;
		/** makes the version open the versions sheet */
		onVersions?: (item: ModListItem) => void;
		onUpdate?: (item: ModListItem) => Promise<void>;
		onUpdateAll?: () => Promise<void>;
		onRemove?: (item: ModListItem) => Promise<void>;
		/** offered when nothing is installed */
		onBrowse?: () => void;
		/** shows the filter box and chips; off for a list that holds one item at most */
		filterable?: boolean;
	} = $props();

	const query = new UrlParam('filter');
	const show = new UrlParam('show', 'all');

	const counts = $derived(countByFilter(items));
	const chosen = $derived(MOD_FILTERS.find((f) => f === show.value) ?? 'all');
	// a filter that empties, say after Update all, falls back to everything
	const filter = $derived(counts[chosen] ? chosen : 'all');
	const titles = $derived(
		new Map(items.flatMap((m) => (m.projectId ? [[m.projectId, m.title] as const] : [])))
	);
	// worked out here, not with `{@const}` in the each block, which breaks hydration of async state
	const shown = $derived(
		filterMods(items, filter, query.value).map((item) => ({
			item,
			why: reason(item, titles)
		}))
	);

	const filters = $derived(
		(
			[
				{ value: 'all', label: 'All' },
				{ value: 'updates', label: 'Updates' },
				{ value: 'disabled', label: 'Disabled' },
				{ value: 'client-only', label: 'Client only' },
				{ value: 'local', label: 'Local' }
			] as const
		).filter((f) => f.value === 'all' || counts[f.value] > 0)
	);
</script>

{#if items.length === 0}
	<Empty.Root class="border">
		<Empty.Header>
			<Empty.Media variant="icon"><PackageOffIcon /></Empty.Media>
			<Empty.Title>No {noun}s yet</Empty.Title>
			<Empty.Description>
				{onBrowse ? `Find ${noun}s to add under Browse.` : `There are no ${noun}s here.`}
			</Empty.Description>
		</Empty.Header>
		{#if onBrowse}
			<Empty.Content><Button onclick={onBrowse}>Browse {noun}s</Button></Empty.Content>
		{/if}
	</Empty.Root>
{:else}
	<div class="flex min-h-0 flex-1 flex-col gap-3">
		{#if filterable}
			<div class="flex flex-wrap items-center gap-2">
				<InputGroup.Root class="w-full sm:w-64">
					<InputGroup.Addon align="inline-start"><FilterIcon /></InputGroup.Addon>
					<InputGroup.Input
						bind:value={query.value}
						placeholder="Filter {noun}s"
						aria-label="Filter {noun}s by name or file"
						autocomplete="off"
						spellcheck="false"
					/>
				</InputGroup.Root>
				{#if filters.length > 1}
					<ToggleGroup.Root
						type="single"
						size="sm"
						spacing={1}
						aria-label="Show"
						bind:value={() => filter, (next) => next && (show.value = next)}
					>
						{#each filters as f (f.value)}
							<ToggleGroup.Item
								value={f.value}
								class="px-2.5 text-muted-foreground tabular-nums data-[state=on]:bg-secondary data-[state=on]:text-foreground"
							>
								{f.label}
								<Badge variant="muted" class="tabular-nums">{counts[f.value]}</Badge>
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				{/if}
				{#if onUpdateAll && counts.updates}
					<Button size="sm" class="ms-auto" onClickPromise={onUpdateAll}>
						Update all ({counts.updates})
					</Button>
				{/if}
			</div>
		{/if}

		{#if shown.length}
			<ul class="min-h-0 flex-1 divide-y overflow-y-auto">
				{#each shown as { item, why } (item.key)}
					<li class="flex items-center gap-3 py-2">
						{#if onToggle}
							<Switch
								checked={item.enabled}
								aria-label="{item.enabled ? 'Disable' : 'Enable'} {item.title}"
								onCheckedChange={(on) => onToggle(item, on)}
							/>
						{/if}
						{#if item.iconUrl}
							<img
								src={item.iconUrl}
								alt=""
								class="size-8 shrink-0 rounded-md bg-muted {item.enabled ? '' : 'opacity-40'}"
							/>
						{:else}
							<div class="size-8 shrink-0 rounded-md bg-muted"></div>
						{/if}
						<div
							class="min-w-0 flex-1 {item.enabled ? '' : 'text-muted-foreground'}"
							title={item.file}
						>
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-medium">{item.title}</span>
								{#if !item.fromModrinth}
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<Badge {...props} variant="outline">Local</Badge>
											{/snippet}
										</Tooltip.Trigger>
										<Tooltip.Content
											>Not from Modrinth, so it has no versions or updates here.</Tooltip.Content
										>
									</Tooltip.Root>
								{/if}
								{#if !item.enabled}<Badge variant="muted">Disabled</Badge>{/if}
							</div>
							{#if why}<p class="truncate text-xs text-muted-foreground">{why}</p>{/if}
							<SideTags
								clientSide={item.clientSide}
								serverSide={item.serverSide}
								class="mt-1 sm:hidden"
							/>
						</div>
						<div class="hidden w-36 shrink-0 sm:block">
							<SideTags clientSide={item.clientSide} serverSide={item.serverSide} />
						</div>
						<div class="flex w-28 shrink-0 justify-end sm:w-44">
							{#if onVersions && item.fromModrinth}
								<Button
									variant="ghost"
									size="sm"
									class="max-w-full min-w-0 font-normal tabular-nums"
									title={item.update
										? `${item.versionNumber}, ${item.update.versionNumber} is out. Choose a version`
										: `${item.versionNumber}. Choose another version`}
									onclick={() => onVersions(item)}
								>
									<span class="truncate {item.update ? 'text-muted-foreground' : ''}">
										{item.versionNumber}
									</span>
									{#if item.update}
										<ArrowRightIcon class="text-success" />
										<span class="truncate text-success">{item.update.versionNumber}</span>
									{/if}
								</Button>
							{:else}
								<span class="truncate px-2.5 text-sm text-muted-foreground tabular-nums">
									{item.versionNumber ?? '–'}
								</span>
							{/if}
						</div>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="ghost" size="icon" aria-label="More for {item.title}">
										<DotsIcon />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-60">
								{#if item.file}
									<DropdownMenu.Label class="truncate text-xs font-normal text-muted-foreground">
										{item.file}
									</DropdownMenu.Label>
									<DropdownMenu.Separator />
								{/if}
								{#if item.update && onUpdate}
									<DropdownMenu.Item onSelect={() => onUpdate(item)}>
										Update to {item.update.versionNumber}
									</DropdownMenu.Item>
								{/if}
								{#if onVersions && item.fromModrinth}
									<DropdownMenu.Item onSelect={() => onVersions(item)}>
										Choose a version…
									</DropdownMenu.Item>
								{/if}
								{#if item.fromModrinth && item.projectId}
									<DropdownMenu.Item>
										{#snippet child({ props })}
											<a
												{...props}
												href="https://modrinth.com/project/{item.projectId}"
												target="_blank"
												rel="noreferrer"
											>
												Open on Modrinth
											</a>
										{/snippet}
									</DropdownMenu.Item>
								{/if}
								{#if onRemove}
									<DropdownMenu.Separator />
									<DropdownMenu.Item variant="destructive" onSelect={() => onRemove(item)}>
										Remove
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</li>
				{/each}
			</ul>
		{:else}
			<Empty.Root class="border">
				<Empty.Header>
					<Empty.Media variant="icon"><SearchOffIcon /></Empty.Media>
					<Empty.Title>No {noun}s match</Empty.Title>
					<Empty.Description>Nothing installed matches “{query.value}”.</Empty.Description>
				</Empty.Header>
				<Empty.Content>
					<Button variant="outline" onclick={() => (query.value = '')}>Clear the filter</Button>
				</Empty.Content>
			</Empty.Root>
		{/if}
	</div>
{/if}
