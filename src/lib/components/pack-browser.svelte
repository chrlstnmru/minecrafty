<script lang="ts">
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import { searchPacks } from '#lib/packs.remote.js';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	let {
		instanceId,
		noun,
		description,
		actionLabel,
		installedIds,
		onInstall
	}: {
		instanceId: number;
		noun: string;
		description: string;
		actionLabel: string;
		/** project ids that are already installed or in use */
		installedIds: Set<string>;
		onInstall: (projectId: string, title: string, versionId?: string) => Promise<void>;
	} = $props();

	const PAGE_SIZE = 20;

	let query = $state('');
	let debounced = $state('');
	let limit = $state(PAGE_SIZE);

	// wait for a pause in typing before asking Modrinth
	$effect(() => {
		const value = query;
		const timer = setTimeout(() => {
			debounced = value;
			limit = PAGE_SIZE;
		}, 300);
		return () => clearTimeout(timer);
	});

	const results = $derived(searchPacks({ id: instanceId, query: debounced, limit }));

	let picker = $state<{ projectId: string; title: string } | null>(null);
	let pickerOpen = $state(false);

	const number = new Intl.NumberFormat('en', { notation: 'compact' });
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Add {noun}s</Card.Title>
		<Card.Description>{description}</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4">
		<InputGroup.Root>
			<InputGroup.Addon align="inline-start">
				{#if results.loading}<Spinner />{:else}<SearchIcon />{/if}
			</InputGroup.Addon>
			<InputGroup.Input
				bind:value={query}
				placeholder="Search {noun}s…"
				autocomplete="off"
				spellcheck="false"
			/>
		</InputGroup.Root>

		{#if results.error}
			<p class="text-sm text-destructive" role="alert">Search failed. Try again shortly.</p>
		{/if}

		<div class="grid gap-1">
			{#each results.current?.hits ?? [] as hit (hit.project_id)}
				<div class="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
					{#if hit.icon_url}
						<img src={hit.icon_url} alt="" class="size-10 shrink-0 rounded-md bg-muted" />
					{:else}
						<div class="size-10 shrink-0 rounded-md bg-muted"></div>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline gap-2">
							<span class="truncate text-sm font-medium">{hit.title}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								by {hit.author} · {number.format(hit.downloads)} downloads
							</span>
						</div>
						<p class="line-clamp-1 text-xs text-muted-foreground">{hit.description}</p>
					</div>
					{#if installedIds.has(hit.project_id)}
						<Badge variant="secondary">In use</Badge>
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
				{#if results.current}
					<p class="text-sm text-muted-foreground">No {noun}s found for this Minecraft version.</p>
				{/if}
			{/each}
		</div>

		{#if results.current && results.current.hits.length < results.current.total}
			<div>
				<Button variant="outline" size="sm" onclick={() => (limit += PAGE_SIZE)}>Show more</Button>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

{#if picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		{instanceId}
		kind="resourcepack"
		projectId={picker.projectId}
		title={picker.title}
		{noun}
		onSelect={(versionId) => onInstall(picker!.projectId, picker!.title, versionId)}
	/>
{/if}
