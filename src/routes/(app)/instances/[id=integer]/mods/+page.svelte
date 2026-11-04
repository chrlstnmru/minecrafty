<script lang="ts">
	import { page } from '$app/state';
	import { useSearchParams } from 'runed/kit';
	import { toast } from 'svelte-sonner';
	import * as v from 'valibot';

	import type { ModListItem } from '#lib/mod-list.js';

	import ModList from '#lib/components/mod-list.svelte';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { getInstance } from '#lib/instances.remote.js';
	import { modSupport } from '#lib/mod-support.js';
	import {
		installMod,
		installedMods,
		modUpdates,
		refreshModSides,
		removeMod,
		setModEnabled,
		updateMod
	} from '#lib/mods.remote.js';
	import { cn } from '#lib/utils.js';

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
	const items = $derived<ModListItem[]>(
		installed.map((mod) => {
			const update = updateByMod.get(mod.id);
			return {
				...mod,
				fromModrinth: mod.source === 'modrinth',
				update: update && { versionNumber: update.versionNumber }
			};
		})
	);

	// The open tab lives in the URL (?view=browse), so a reload keeps it. Read from the page URL,
	// which the server has; runed only reads it in the browser, so it is used to write it.
	const VIEWS = ['installed', 'browse'] as const;
	const params = useSearchParams(
		v.object({ view: v.optional(v.fallback(v.picklist(VIEWS), 'installed'), 'installed') }),
		{ pushHistory: false, noScroll: true }
	);
	const view = $derived(
		VIEWS.find((name) => name === page.url.searchParams.get('view')) ?? 'installed'
	);

	let picker = $state<{
		projectId: string;
		title: string;
		modId: number;
		currentVersionId: string;
	} | null>(null);
	let pickerOpen = $state(false);

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

	// mods recorded before this was kept learn where they run, once per server
	let askedSides: number | null = null;
	$effect(() => {
		if (askedSides === id) return;
		if (installed.some((m) => m.source === 'modrinth' && (!m.clientSide || !m.serverSide))) {
			askedSides = id;
			void refreshModSides(id).catch(() => undefined);
		}
	});

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
	<div class="flex min-h-0 flex-1 flex-col gap-4">
		<Tabs.Root
			value={view}
			onValueChange={(value) => (params.view = value as (typeof VIEWS)[number])}
		>
			<Tabs.List>
				<Tabs.Trigger value="installed"
					>Installed <Badge variant="muted" class="tabular-nums">{installed.length}</Badge
					></Tabs.Trigger
				>
				<Tabs.Trigger value="browse">Browse</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<!-- the tabs stay put and the open tab scrolls; rows are max-content so cards are not squashed to fit, and the padding keeps their ring from being clipped -->
		<div
			class={cn(
				'-m-1 grid min-h-0 flex-1 auto-rows-max content-start gap-4 overflow-y-auto p-1',
				// each tab's card grows to its rows, up to the height left, then scrolls its own list
				'flex flex-col'
			)}
		>
			{#if view === 'installed'}
				<Card.Root class="min-h-0">
					<Card.Header>
						<Card.Title>Installed {info.noun}s</Card.Title>
						<Card.Description>
							Files in <code class="font-mono">{info.folder}/</code>. Changes apply the next time
							the server starts.
						</Card.Description>
					</Card.Header>
					<Card.Content class="flex min-h-0 flex-1 flex-col">
						<ModList
							{items}
							noun={info.noun}
							onToggle={(mod, on) => toggle(mod.id, mod.title, on)}
							onVersions={(mod) => {
								picker = {
									projectId: mod.projectId!,
									title: mod.title,
									modId: mod.id,
									currentVersionId: mod.versionId ?? ''
								};
								pickerOpen = true;
							}}
							onUpdate={(mod) => change(mod.id, mod.title)}
							onUpdateAll={updateAll}
							onRemove={(mod) => remove(mod.id, mod.title)}
							onBrowse={() => (params.view = 'browse')}
						/>
					</Card.Content>
				</Card.Root>
			{:else}
				<PackBrowser
					kind="mod"
					instanceId={id}
					noun={info.noun}
					description="From Modrinth, for {info.loader} on Minecraft {info.mcVersion}. Required dependencies are installed with them."
					actionLabel="Install"
					installedLabel="Installed"
					{installedIds}
					onInstall={install}
				/>
			{/if}
		</div>
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
		onSelect={(versionId) => change(picker!.modId, picker!.title, versionId)}
	/>
{/if}
