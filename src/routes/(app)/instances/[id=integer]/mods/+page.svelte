<script lang="ts">
	import { page } from '$app/state';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import { toast } from 'svelte-sonner';
	import {
		installMod,
		installedMods,
		modUpdates,
		modsInfo,
		removeMod,
		searchMods,
		updateMod
	} from '#lib/mods.remote.js';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import SkeletonRows from '#lib/components/skeleton-rows.svelte';
	import { Spinner } from '#lib/components/ui/spinner/index.js';

	const PAGE_SIZE = 20;

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const info = $derived(await modsInfo(id));
	const installed = $derived(installedMods(id));
	const installedIds = $derived(new Set(installed.current?.map((m) => m.projectId)));

	const updates = $derived(modUpdates(id));
	const updateByMod = $derived(new Map(updates.current?.map((u) => [u.modId, u])));

	// the version picker serves both installing a chosen version and changing an installed one
	let picker = $state<{
		projectId: string;
		title: string;
		modId?: number;
		currentVersionId?: string;
	} | null>(null);
	let pickerOpen = $state(false);

	function pickVersion(target: NonNullable<typeof picker>) {
		picker = target;
		pickerOpen = true;
	}

	async function onPick(versionId: string) {
		if (!picker) return;
		const { projectId, title, modId } = picker;
		if (modId) await change(modId, title, versionId);
		else await install(projectId, title, versionId);
	}

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

	const results = $derived(info?.supported ? searchMods({ id, query: debounced, limit }) : null);

	function message(e: unknown, fallback: string) {
		return (e as { body?: { message?: string } }).body?.message ?? fallback;
	}

	async function install(projectId: string, title: string, versionId?: string) {
		try {
			const res = await installMod({ id, projectId, versionId });
			const deps = res.installed.length - 1;
			toast.success(`Installed ${title}`, {
				description:
					deps > 0
						? `Plus ${deps} required ${deps === 1 ? 'dependency' : 'dependencies'}.`
						: undefined
			});
			if (res.skipped.length)
				toast.warning('Some dependencies were skipped', {
					description: `No compatible version of ${res.skipped.join(', ')}.`
				});
		} catch (e) {
			toast.error(message(e, 'Install failed'));
		}
	}

	async function change(modId: number, title: string, versionId?: string) {
		try {
			const res = await updateMod({ id, modId, versionId });
			toast.success(`${title} is now ${res.installed[0]?.version ?? 'updated'}`);
		} catch (e) {
			toast.error(message(e, 'Update failed'));
		}
	}

	async function updateAll() {
		for (const u of updates.current ?? []) {
			const title = installed.current?.find((m) => m.id === u.modId)?.title ?? 'mod';
			await change(u.modId, title);
		}
	}

	async function remove(modId: number, title: string) {
		try {
			await removeMod({ id, modId });
			toast.success(`Removed ${title}`);
		} catch (e) {
			toast.error(message(e, 'Remove failed'));
		}
	}

	const number = new Intl.NumberFormat('en', { notation: 'compact' });
</script>

{#if info && !info.supported}
	<Card.Root>
		<Card.Header>
			<Card.Title>Mods are not available</Card.Title>
			<Card.Description>
				{info.loader} servers cannot load mods or plugins. Create a Fabric, Quilt, Forge, NeoForge, Paper
				or Purpur instance to use them.
			</Card.Description>
		</Card.Header>
	</Card.Root>
{:else if info}
	<div class="grid gap-4">
		<Card.Root>
			<Card.Header>
				<Card.Title>Installed {info.noun}s</Card.Title>
				{#if updates.current?.length}
					<Card.Action>
						<Button size="sm" onClickPromise={updateAll}>
							Update all ({updates.current.length})
						</Button>
					</Card.Action>
				{/if}
				<Card.Description>
					Files in <code class="font-mono">{info.folder}/</code>. Changes apply the next time the
					server starts.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if !installed.current}<SkeletonRows count={3} icon="size-9" />{/if}
				{#each installed.current ?? [] as mod (mod.id)}
					{@const update = updateByMod.get(mod.id)}
					<div class="flex items-center gap-3 border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
						{#if mod.iconUrl}
							<img src={mod.iconUrl} alt="" class="size-9 shrink-0 rounded-md bg-muted" />
						{:else}
							<div class="size-9 shrink-0 rounded-md bg-muted"></div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-medium">{mod.title}</span>
								{#if mod.dependencyOf}<Badge variant="outline">dependency</Badge>{/if}
							</div>
							<p class="truncate text-xs text-muted-foreground">
								{mod.versionNumber} · {mod.file}
							</p>
						</div>
						{#if update}
							<Button size="sm" onClickPromise={() => change(mod.id, mod.title)}>
								Update to {update.versionNumber}
							</Button>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							onclick={() =>
								pickVersion({
									projectId: mod.projectId,
									title: mod.title,
									modId: mod.id,
									currentVersionId: mod.versionId
								})}
						>
							Versions
						</Button>
						<Button variant="ghost" size="sm" onClickPromise={() => remove(mod.id, mod.title)}>
							Remove
						</Button>
					</div>
				{:else}
					{#if installed.current}
						<p class="text-sm text-muted-foreground">Nothing installed yet.</p>
					{/if}
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Add {info.noun}s</Card.Title>
				<Card.Description>
					From Modrinth, filtered to {info.loader} and Minecraft {info.mcVersion}. Client-only {info.noun}s
					are hidden.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<InputGroup.Root>
					<InputGroup.Addon align="inline-start">
						{#if results?.loading}<Spinner />{:else}<SearchIcon />{/if}
					</InputGroup.Addon>
					<InputGroup.Input
						bind:value={query}
						placeholder="Search {info.noun}s…"
						autocomplete="off"
						spellcheck="false"
					/>
				</InputGroup.Root>

				{#if results?.error}
					<p class="text-sm text-destructive" role="alert">
						{message(results.error, 'Search failed')}
					</p>
				{/if}

				{#if !results?.current && !results?.error}<SkeletonRows count={5} />{/if}
				<div class="grid gap-1">
					{#each results?.current?.hits ?? [] as hit (hit.project_id)}
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
								<Badge variant="secondary">Installed</Badge>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => pickVersion({ projectId: hit.project_id, title: hit.title })}
								>
									Versions
								</Button>
								<Button size="sm" onClickPromise={() => install(hit.project_id, hit.title)}>
									Install
								</Button>
							{/if}
						</div>
					{:else}
						{#if results?.current}
							<p class="text-sm text-muted-foreground">No {info.noun}s found.</p>
						{/if}
					{/each}
				</div>

				{#if results?.current && results.current.hits.length < results.current.total}
					<div>
						<Button variant="outline" size="sm" onclick={() => (limit += PAGE_SIZE)}>
							Show more
						</Button>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
{/if}

{#if info?.supported && picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		instanceId={id}
		projectId={picker.projectId}
		title={picker.title}
		noun={info.noun}
		currentVersionId={picker.currentVersionId}
		onSelect={onPick}
	/>
{/if}
