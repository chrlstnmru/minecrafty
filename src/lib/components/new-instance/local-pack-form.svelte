<script lang="ts">
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import { listLocalPacks } from '#lib/builder.remote.js';
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import LoaderBadge from '#lib/components/loader-badge.svelte';
	import MakeServerForm from '#lib/components/make-server-form.svelte';
	import SkeletonRows from '#lib/components/skeleton-rows.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';

	let { onDone }: { onDone: () => void } = $props();

	const packs = listLocalPacks();
	let chosen = $state<number | null>(null);
	const pack = $derived(packs.current?.find((p) => p.id === chosen));
</script>

<div class="min-h-0 flex-1 overflow-y-auto">
	{#if pack}
		<div class="grid gap-4">
			<Button variant="ghost" size="sm" class="w-fit" onclick={() => (chosen = null)}>
				<ArrowLeftIcon />Packs
			</Button>
			<div class="grid gap-2 rounded-lg border p-3 text-sm">
				<div class="flex flex-wrap items-center gap-2">
					<span class="font-medium">{pack.name}</span>
					<LoaderBadge loader={pack.loader} version={pack.loaderVersion} />
					<Badge variant="muted">Minecraft {pack.mcVersion}</Badge>
				</div>
				<p class="text-muted-foreground">
					{pack.files}
					{pack.files === 1 ? 'file' : 'files'}, revision {pack.revision}.
				</p>
			</div>
			<MakeServerForm packId={pack.id} packName={pack.name} {onDone} />
		</div>
	{:else if !packs.current}
		<SkeletonRows count={3} />
	{:else if !packs.current.length}
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Title>No packs yet</Empty.Title>
				<Empty.Description
					>Build one in the Modpack builder, then it shows up here.</Empty.Description
				>
			</Empty.Header>
			<Empty.Content>
				<Button size="sm" href="/modpacks">Open the Modpack builder</Button>
			</Empty.Content>
		</Empty.Root>
	{:else}
		<div class="grid gap-1">
			{#each packs.current as p (p.id)}
				<button
					type="button"
					class="flex items-center gap-3 rounded-lg p-3 text-start hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					onclick={() => (chosen = p.id)}
				>
					<InstanceIcon loader={p.loader} packIconUrl={p.iconUrl} />
					<div class="grid min-w-0 flex-1 gap-1">
						<span class="truncate text-sm font-medium">{p.name}</span>
						<span class="text-xs text-muted-foreground">
							{p.loader} · Minecraft {p.mcVersion} · {p.files}
							{p.files === 1 ? 'file' : 'files'} · revision {p.revision}
						</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
