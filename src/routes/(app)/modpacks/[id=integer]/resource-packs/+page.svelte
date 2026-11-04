<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	import type { ModListItem } from '#lib/mod-list.js';

	import InstalledBrowseTabs from '#lib/components/installed-browse-tabs.svelte';
	import ModList from '#lib/components/mod-list.svelte';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { viewParam } from '#lib/installed-browse.svelte.js';
	import {
		addPackResourcePack,
		clearPackServerPack,
		getLocalPack,
		removePackFile,
		setPackFileVersion,
		setPackServerPack
	} from '#lib/modpacks/builder.remote.js';
	import { fileItem, isResourcePack, serverPackItems } from '#lib/modpacks/pack-files.js';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const pack = $derived(await getLocalPack({ id }));
	const canWrite = $derived(data.panel.includes('modpacks.write'));
	const view = viewParam(() => canWrite);

	// the server pack first, then the packs for players; every one of those runs only in the game,
	// so a Client tag on each would say nothing
	const items = $derived([
		...serverPackItems(pack),
		...pack.files
			.filter(isResourcePack)
			.map((file) => ({ ...fileItem(file), clientSide: null, serverSide: null }))
	]);
	const inPack = $derived(new Set(pack.files.flatMap((f) => (f.projectId ? [f.projectId] : []))));

	let picker = $state<ModListItem | null>(null);
	let pickerOpen = $state(false);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	async function addForPlayers(projectId: string, title: string, versionId?: string) {
		try {
			await addPackResourcePack({ id, projectId, versionId });
			toast.success(`Added ${title}`);
		} catch (e) {
			toast.error(message(e, `Could not add ${title}`));
		}
	}

	async function useServerPack(projectId: string, title: string, versionId?: string) {
		try {
			const result = await setPackServerPack({ id, projectId, versionId });
			toast.success(`${title} is now the server resource pack`, {
				description: `${result.version}. Servers made from this pack start with it.`
			});
		} catch (e) {
			toast.error(message(e, 'Could not set the server resource pack'));
		}
	}

	async function remove(item: ModListItem) {
		try {
			if (item.id === null) await clearPackServerPack({ id });
			else await removePackFile({ id, fileId: item.id });
			toast.success(`Removed ${item.title}`);
		} catch (e) {
			toast.error(message(e, `Could not remove ${item.title}`));
		}
	}

	async function repin(item: ModListItem, versionId: string) {
		if (item.id === null) return useServerPack(item.projectId!, item.title, versionId);
		try {
			await setPackFileVersion({ id, fileId: item.id, versionId });
			toast.success(`Changed ${item.title}`);
		} catch (e) {
			toast.error(message(e, 'Could not change the version'));
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<InstalledBrowseTabs {view} count={items.length} canBrowse={canWrite} />

	<!-- the tabs stay put; the list's card grows to its rows, up to the height left, then scrolls its own list -->
	<div class="-m-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
		{#if view.current === 'installed'}
			<Card.Root class="min-h-0">
				<Card.Header>
					<Card.Title>Resource packs in this pack</Card.Title>
					<Card.Description>
						Packs for players go in the .mrpack for their launchers. The server pack does not:
						servers made from this pack prompt players to download it.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex min-h-0 flex-1 flex-col">
					<ModList
						{items}
						noun="resource pack"
						onVersions={canWrite
							? (item) => {
									picker = item;
									pickerOpen = true;
								}
							: undefined}
						onRemove={canWrite ? remove : undefined}
						onBrowse={canWrite ? () => (view.current = 'browse') : undefined}
					/>
				</Card.Content>
			</Card.Root>
		{:else}
			<PackBrowser
				kind="pack-resourcepack"
				instanceId={id}
				noun="resource pack"
				description="For Minecraft {pack.mcVersion}. Add puts one in the .mrpack for players' launchers; the menu next to it makes one the server pack instead."
				actionLabel="Add"
				installedLabel="In pack"
				installedIds={inPack}
				onInstall={addForPlayers}
				actions={[
					{
						label: 'Use as server pack',
						done: new Set(pack.serverPackProjectId ? [pack.serverPackProjectId] : []),
						doneLabel: 'The server pack',
						run: useServerPack
					}
				]}
			/>
		{/if}
	</div>
</div>

{#if picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		kind="pack-resourcepack"
		instanceId={id}
		projectId={picker.projectId!}
		title={picker.title}
		noun="resource pack"
		currentVersionId={picker.versionId ?? ''}
		onSelect={(versionId) => repin(picker!, versionId)}
	/>
{/if}
