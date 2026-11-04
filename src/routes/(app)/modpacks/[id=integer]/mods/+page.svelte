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
		addPackMod,
		getLocalPack,
		removePackFile,
		setPackFileVersion
	} from '#lib/modpacks/builder.remote.js';
	import { fileItem, isResourcePack } from '#lib/modpacks/pack-files.js';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const pack = $derived(await getLocalPack({ id }));
	const canWrite = $derived(data.panel.includes('modpacks.write'));
	const view = viewParam(() => canWrite);

	const items = $derived(pack.files.filter((f) => !isResourcePack(f)).map(fileItem));
	const inPack = $derived(new Set(pack.files.flatMap((f) => (f.projectId ? [f.projectId] : []))));

	let picker = $state<ModListItem | null>(null);
	let pickerOpen = $state(false);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	async function add(projectId: string, title: string, versionId?: string) {
		try {
			const result = await addPackMod({ id, projectId, versionId });
			const extra = result.added.length - 1;
			toast.success(
				extra > 0
					? `Added ${title} and ${extra} required ${extra === 1 ? 'mod' : 'mods'}`
					: `Added ${title}`
			);
			if (result.skipped.length)
				toast.warning(`No compatible version of ${result.skipped.join(', ')}`);
		} catch (e) {
			toast.error(message(e, `Could not add ${title}`));
		}
	}

	async function remove(item: ModListItem) {
		try {
			await removePackFile({ id, fileId: item.id! });
			toast.success(`Removed ${item.title}`);
		} catch (e) {
			toast.error(message(e, `Could not remove ${item.title}`));
		}
	}

	async function repin(item: ModListItem, versionId: string) {
		try {
			await setPackFileVersion({ id, fileId: item.id!, versionId });
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
					<Card.Title>Mods in this pack</Card.Title>
					<Card.Description>
						Each one is pinned to a version. Servers made from the pack install exactly these.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex min-h-0 flex-1 flex-col">
					<ModList
						{items}
						noun="mod"
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
				kind="pack"
				instanceId={id}
				noun="mod"
				description="Mods for {pack.loader} on Minecraft {pack.mcVersion}. Required dependencies come with them, each pinned to one version."
				actionLabel="Add"
				installedLabel="In pack"
				installedIds={inPack}
				onInstall={add}
			/>
		{/if}
	</div>
</div>

{#if picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		kind="pack"
		instanceId={id}
		projectId={picker.projectId!}
		title={picker.title}
		noun="mod"
		currentVersionId={picker.versionId ?? ''}
		onSelect={(versionId) => repin(picker!, versionId)}
	/>
{/if}
