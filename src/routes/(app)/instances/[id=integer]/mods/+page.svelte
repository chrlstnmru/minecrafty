<script lang="ts">
	import { page } from '$app/state';
	import PackageOffIcon from '@tabler/icons-svelte/icons/package-off';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import SearchOffIcon from '@tabler/icons-svelte/icons/search-off';
	import { toast } from 'svelte-sonner';

	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import SkeletonRows from '#lib/components/skeleton-rows.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { getInstance } from '#lib/instances.remote.js';
	import { modSupport } from '#lib/mod-support.js';
	import {
		installMod,
		disableClientOnlyMods,
		installedMods,
		modUpdates,
		refreshModSides,
		removeMod,
		setModEnabled,
		searchMods,
		updateMod
	} from '#lib/mods.remote.js';

	const PAGE_SIZE = 20;

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// Starts the list and the update check together; the await below joins the request in flight.
	$effect.pre(() => {
		void installedMods(id).current;
		void modUpdates(id).current;
	});
	// what the loader can install needs no request: the layout has loaded the instance already
	const instance = $derived(getInstance(id).current);
	const info = $derived(
		instance
			? { ...modSupport(instance.loader), loader: instance.loader, mcVersion: instance.mcVersion }
			: undefined
	);
	// awaited, so the server renders the list and the browser hydrates the same markup
	const installed = $derived(await installedMods(id));
	const installedIds = $derived(new Set(installed.map((m) => m.projectId)));

	const updates = $derived(modUpdates(id));
	const updateByMod = $derived(new Map(updates.current?.map((u) => [u.modId, u])));
	// computed here: a `{@const}` reading async state inside the each block breaks hydration
	const rows = $derived(installed.map((mod) => ({ mod, update: updateByMod.get(mod.id) })));

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
			const title = installed.find((m) => m.id === u.modId)?.title ?? 'mod';
			await change(u.modId, title);
		}
	}

	/** What the project says about where a mod runs, as badges; nothing while that is unknown. */
	function sides(mod: { clientSide: string | null; serverSide: string | null }) {
		if (!mod.clientSide || !mod.serverSide) return [];
		const label = (name: string, side: string) =>
			`${name}: ${side === 'required' ? 'required' : 'optional'}`;
		if (mod.serverSide === 'unsupported')
			return [
				{ text: 'Client only', variant: 'warning', title: 'Does not run on a server' }
			] as const;
		if (mod.clientSide === 'unsupported')
			return [{ text: 'Server only', variant: 'info', title: 'Does not run on a client' }] as const;
		return [
			{
				text: 'Client',
				variant: mod.clientSide === 'required' ? 'info' : 'muted',
				title: label('Client', mod.clientSide)
			},
			{
				text: 'Server',
				variant: mod.serverSide === 'required' ? 'success' : 'muted',
				title: label('Server', mod.serverSide)
			}
		] as const;
	}

	const clientOnly = $derived(
		installed.filter((m) => m.enabled && m.serverSide === 'unsupported').length
	);

	// mods recorded before this was kept learn where they run, once per server
	let askedSides: number | null = null;
	$effect(() => {
		if (askedSides === id) return;
		if (installed.some((m) => m.source === 'modrinth' && (!m.clientSide || !m.serverSide))) {
			askedSides = id;
			void refreshModSides(id).catch(() => undefined);
		}
	});

	async function disableClientSide() {
		try {
			const titles = await disableClientOnlyMods(id);
			toast.success(
				`Disabled ${titles.length} client-only ${titles.length === 1 ? 'mod' : 'mods'}`,
				{
					description: 'Restart the server to apply.'
				}
			);
		} catch (e) {
			toast.error(message(e, 'Could not disable them'));
		}
	}

	async function toggle(modId: number, title: string, enabled: boolean) {
		try {
			await setModEnabled({ id, modId, enabled });
			toast.success(`${enabled ? 'Enabled' : 'Disabled'} ${title}`, {
				description: 'Restart the server to apply.'
			});
		} catch (e) {
			toast.error(message(e, 'Could not change it'));
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
				<Card.Description>
					Files in <code class="font-mono">{info.folder}/</code>. Changes apply the next time the
					server starts.
				</Card.Description>
				{#if updates.current?.length || clientOnly}
					<Card.Action class="flex flex-wrap gap-2">
						{#if clientOnly}
							<Button variant="outline" size="sm" onClickPromise={disableClientSide}>
								Disable client-only ({clientOnly})
							</Button>
						{/if}
						{#if updates.current?.length}
							<Button size="sm" onClickPromise={updateAll}>
								Update all ({updates.current.length})
							</Button>
						{/if}
					</Card.Action>
				{/if}
			</Card.Header>
			<Card.Content>
				{#each rows as { mod, update } (mod.id)}
					<div class="flex items-center gap-3 border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
						<Switch
							checked={mod.enabled}
							aria-label="{mod.enabled ? 'Disable' : 'Enable'} {mod.title}"
							onCheckedChange={(on) => toggle(mod.id, mod.title, on)}
						/>
						{#if mod.iconUrl}
							<img
								src={mod.iconUrl}
								alt=""
								class="size-9 shrink-0 rounded-md bg-muted {mod.enabled ? '' : 'opacity-50'}"
							/>
						{:else}
							<div
								class="size-9 shrink-0 rounded-md bg-muted {mod.enabled ? '' : 'opacity-50'}"
							></div>
						{/if}
						<div class="min-w-0 flex-1 {mod.enabled ? '' : 'text-muted-foreground'}">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-medium">{mod.title}</span>
								{#if !mod.enabled}<Badge variant="muted">Disabled</Badge>{/if}
								{#if mod.dependencyOf}<Badge variant="pink">Dependency</Badge>{/if}
								{#each sides(mod) as side (side.text)}
									<Badge variant={side.variant} title={side.title}>{side.text}</Badge>
								{/each}
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
					<Empty.Root class="border">
						<Empty.Header>
							<Empty.Media variant="icon"><PackageOffIcon /></Empty.Media>
							<Empty.Title>Nothing installed yet</Empty.Title>
							<Empty.Description>Search below to add {info.noun}s.</Empty.Description>
						</Empty.Header>
					</Empty.Root>
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
								<Badge variant="mint">Installed</Badge>
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
							<Empty.Root class="border">
								<Empty.Header>
									<Empty.Media variant="icon"><SearchOffIcon /></Empty.Media>
									<Empty.Title>No {info.noun}s found</Empty.Title>
									<Empty.Description>Try a different search.</Empty.Description>
								</Empty.Header>
							</Empty.Root>
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
