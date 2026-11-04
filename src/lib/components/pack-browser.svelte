<script lang="ts">
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import SearchOffIcon from '@tabler/icons-svelte/icons/search-off';

	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import SideTags from '#lib/components/side-tags.svelte';
	import SkeletonRows from '#lib/components/skeleton-rows.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { searchPackMods } from '#lib/modpacks/builder.remote.js';
	import { searchMods } from '#lib/mods.remote.js';
	import { searchPacks } from '#lib/packs.remote.js';
	import { UrlParam } from '#lib/url-param.svelte.js';

	let {
		instanceId,
		kind = 'resourcepack',
		noun,
		description,
		actionLabel,
		installedLabel = 'In use',
		installedIds,
		onInstall
	}: {
		/** the instance's id, or the pack's when `kind` is `pack` */
		instanceId: number;
		/** `mod`: mods or plugins for an instance; `pack`: mods for a modpack made in the builder */
		kind?: 'resourcepack' | 'mod' | 'pack';
		noun: string;
		description: string;
		actionLabel: string;
		installedLabel?: string;
		/** project ids that are already installed or in use */
		installedIds: Set<string>;
		onInstall: (projectId: string, title: string, versionId?: string) => Promise<void>;
	} = $props();

	const PAGE_SIZE = 20;

	const query = new UrlParam('q');
	let debounced = $state(query.value);
	let limit = $state(PAGE_SIZE);

	// wait for a pause in typing before asking Modrinth
	$effect(() => {
		const value = query.value;
		const timer = setTimeout(() => {
			debounced = value;
			limit = PAGE_SIZE;
		}, 300);
		return () => clearTimeout(timer);
	});

	const results = $derived(
		kind === 'pack'
			? searchPackMods({ id: instanceId, query: debounced, limit })
			: kind === 'mod'
				? searchMods({ id: instanceId, query: debounced, limit })
				: searchPacks({ id: instanceId, query: debounced, limit })
	);

	let picker = $state<{ projectId: string; title: string } | null>(null);
	let pickerOpen = $state(false);

	const number = new Intl.NumberFormat('en', { notation: 'compact' });
</script>

<Card.Root class="min-h-0">
	<Card.Header>
		<Card.Title>Browse {noun}s</Card.Title>
		<Card.Description>
			{description}
		</Card.Description>
	</Card.Header>
	<!-- in a height-bound column the search box stays put and only the results scroll -->
	<Card.Content class="flex min-h-0 flex-1 flex-col gap-4">
		<InputGroup.Root>
			<InputGroup.Addon align="inline-start"><SearchIcon /></InputGroup.Addon>
			<InputGroup.Input
				bind:value={query.value}
				placeholder="Search {noun}s…"
				autocomplete="off"
				spellcheck="false"
			/>
		</InputGroup.Root>

		<svelte:boundary>
			{@const found = await results}
			<!-- a new search keeps the last results on screen, dimmed, until it answers -->
			<div
				class="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto transition-opacity {$effect.pending()
					? 'opacity-50'
					: ''}"
				aria-busy={$effect.pending() > 0}
			>
				{#each found.hits as hit (hit.project_id)}
					<div class="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
						{#if hit.icon_url}
							<img src={hit.icon_url} alt="" class="size-10 shrink-0 rounded-md bg-muted" />
						{:else}
							<div class="size-10 shrink-0 rounded-md bg-muted"></div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2">
								<span class="truncate text-sm font-medium">{hit.title}</span>
								{#if kind !== 'resourcepack'}
									<SideTags
										clientSide={hit.client_side}
										serverSide={hit.server_side}
										class="self-center"
									/>
								{/if}
								<span class="shrink-0 text-xs text-muted-foreground">
									by {hit.author} · {number.format(hit.downloads)} downloads
								</span>
							</div>
							<p class="line-clamp-1 text-xs text-muted-foreground">{hit.description}</p>
						</div>
						{#if installedIds.has(hit.project_id)}
							<Badge variant="mint">{installedLabel}</Badge>
						{:else}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => {
									picker = { projectId: hit.project_id, title: hit.title };
									pickerOpen = true;
								}}
							>
								Versions
							</Button>
							<Button size="sm" onClickPromise={() => onInstall(hit.project_id, hit.title)}>
								{actionLabel}
							</Button>
						{/if}
					</div>
				{:else}
					<Empty.Root class="border">
						<Empty.Header>
							<Empty.Media variant="icon"><SearchOffIcon /></Empty.Media>
							<Empty.Title>No {noun}s found</Empty.Title>
							<Empty.Description
								>None match this search for this Minecraft version.</Empty.Description
							>
						</Empty.Header>
					</Empty.Root>
				{/each}

				{#if found.hits.length < found.total}
					<div class="pt-3">
						<Button variant="outline" size="sm" onclick={() => (limit += PAGE_SIZE)}
							>Show more</Button
						>
					</div>
				{/if}
			</div>

			{#snippet pending()}
				<SkeletonRows count={5} />
			{/snippet}

			{#snippet failed(error, reset)}
				<Empty.Root class="border" role="alert">
					<Empty.Header>
						<Empty.Title>Could not search Modrinth</Empty.Title>
						<Empty.Description>
							{(error as { body?: { message?: string } }).body?.message ??
								'Modrinth did not answer.'} Try again in a moment.
						</Empty.Description>
					</Empty.Header>
					<Empty.Content>
						<Button variant="outline" onclick={reset}>Try again</Button>
					</Empty.Content>
				</Empty.Root>
			{/snippet}
		</svelte:boundary>
	</Card.Content>
</Card.Root>

{#if picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		{instanceId}
		{kind}
		projectId={picker.projectId}
		title={picker.title}
		{noun}
		onSelect={(versionId) => onInstall(picker!.projectId, picker!.title, versionId)}
	/>
{/if}
