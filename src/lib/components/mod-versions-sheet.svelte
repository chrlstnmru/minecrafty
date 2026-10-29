<script lang="ts">
	import { modVersions } from '#lib/mods.remote.js';
	import { packVersions } from '#lib/packs.remote.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	let {
		open = $bindable(false),
		instanceId,
		projectId,
		title,
		noun,
		kind = 'mod',
		currentVersionId,
		onSelect
	}: {
		open?: boolean;
		instanceId: number;
		projectId: string;
		title: string;
		noun: string;
		kind?: 'mod' | 'resourcepack';
		/** set when changing an installed mod; that version is marked and not selectable */
		currentVersionId?: string;
		onSelect: (versionId: string) => Promise<void>;
	} = $props();

	// only ask Modrinth while the sheet is open
	const versions = $derived(
		!open
			? null
			: kind === 'mod'
				? modVersions({ id: instanceId, projectId })
				: packVersions({ id: instanceId, projectId })
	);

	const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const typeVariant = { release: 'secondary', beta: 'outline', alpha: 'outline' } as const;

	async function choose(versionId: string) {
		await onSelect(versionId);
		open = false;
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="flex w-full flex-col gap-0 sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>{title}</Sheet.Title>
			<Sheet.Description>
				Versions that run on this server's loader and Minecraft version. Required dependencies are
				installed with the {noun}.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex-1 overflow-y-auto px-4 pb-4">
			{#if versions?.loading && !versions.current}
				<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
					<Spinner />Loading versions…
				</div>
			{:else if versions?.error}
				<p class="py-4 text-sm text-destructive" role="alert">Could not load versions.</p>
			{/if}
			{#each versions?.current ?? [] as v (v.id)}
				<div class="flex items-center gap-3 border-b py-2 last:border-b-0">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate text-sm font-medium">{v.versionNumber}</span>
							{#if v.versionType !== 'release'}
								<Badge variant={typeVariant[v.versionType]}>{v.versionType}</Badge>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">{date.format(new Date(v.publishedAt))}</p>
					</div>
					{#if v.id === currentVersionId}
						<Badge>Installed</Badge>
					{:else}
						<Button size="sm" variant="outline" onClickPromise={() => choose(v.id)}>
							{currentVersionId ? 'Use this' : 'Install'}
						</Button>
					{/if}
				</div>
			{:else}
				{#if versions?.current}
					<p class="py-4 text-sm text-muted-foreground">No compatible versions.</p>
				{/if}
			{/each}
		</div>
	</Sheet.Content>
</Sheet.Root>
