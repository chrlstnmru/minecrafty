<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import FileCodeIcon from '@tabler/icons-svelte/icons/file-code';
	import PackageIcon from '@tabler/icons-svelte/icons/package';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import SettingsIcon from '@tabler/icons-svelte/icons/settings';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import { useSearchParams } from 'runed/kit';
	import { toast } from 'svelte-sonner';
	import * as v from 'valibot';

	import type { ModListItem } from '#lib/mod-list.js';

	import Combobox from '#lib/components/combobox.svelte';
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import LoaderBadge from '#lib/components/loader-badge.svelte';
	import MakeServerDialog from '#lib/components/make-server-dialog.svelte';
	import ModList from '#lib/components/mod-list.svelte';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import PackConfigs from '#lib/components/pack-configs.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import {
		addPackMod,
		applyPackVersionChange,
		deleteLocalPack,
		getLocalPack,
		packLoaderBuilds,
		packMinecraftVersions,
		previewPackVersionChange,
		removePackFile,
		removePackIcon,
		setPackFileVersion,
		setPackLoaderVersion,
		updateLocalPack
	} from '#lib/modpacks/builder.remote.js';
	import { cn } from '#lib/utils.js';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const loadedPack = $derived(getLocalPack({ id }));
	const pack = $derived(await loadedPack);
	const canWrite = $derived(data.panel.includes('modpacks.write'));
	const canMakeServer = $derived(data.panel.includes('instances.create'));

	// The selected tab lives in the URL (?tab=configs), so a reload or a shared link opens the same
	// one. It is read from the page URL, which the server has, so the right tab is in the HTML; runed
	// only reads the URL in the browser, so it is used to write it.
	const TABS = ['mods', 'configs', 'settings'] as const;
	const VIEWS = ['installed', 'browse'] as const;
	const params = useSearchParams(
		v.object({
			tab: v.optional(v.fallback(v.picklist(TABS), 'mods'), 'mods'),
			view: v.optional(v.fallback(v.picklist(VIEWS), 'installed'), 'installed')
		}),
		{ pushHistory: false, noScroll: true }
	);
	const wanted = $derived(page.url.searchParams.get('tab'));
	const tab = $derived(
		TABS.find((name) => name === wanted && (name !== 'settings' || canWrite)) ?? 'mods'
	);
	// Browse is for adding, so it is open only to those who may change the pack
	const view = $derived(
		(canWrite && VIEWS.find((name) => name === page.url.searchParams.get('view'))) || 'installed'
	);
	const sections = $derived([
		{ name: 'mods', label: 'Mods', icon: PackageIcon, count: pack.files.length },
		{ name: 'configs', label: 'Configs', icon: FileCodeIcon, count: pack.overrides.length },
		...(canWrite ? [{ name: 'settings', label: 'Settings', icon: SettingsIcon }] : [])
	] as { name: (typeof TABS)[number]; label: string; icon: typeof PackageIcon; count?: number }[]);
	let makingServer = $state(false);
	let deleting = $state(false);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	const items = $derived<ModListItem[]>(
		(pack.files ?? []).map((file) => ({
			...file,
			file: file.path,
			enabled: true,
			fromModrinth: !!file.projectId
		}))
	);
	const inPack = $derived(
		new Set((pack.files ?? []).flatMap((f) => (f.projectId ? [f.projectId] : [])))
	);

	let picker = $state<{
		projectId: string;
		title: string;
		fileId: number;
		versionId: string;
	} | null>(null);
	let pickerOpen = $state(false);

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

	async function remove(fileId: number, title: string) {
		try {
			await removePackFile({ id, fileId });
			toast.success(`Removed ${title}`);
		} catch (e) {
			toast.error(message(e, `Could not remove ${title}`));
		}
	}

	async function repin(versionId: string) {
		if (!picker) return;
		try {
			await setPackFileVersion({ id, fileId: picker.fileId, versionId });
			toast.success(`Changed ${picker.title}`);
		} catch (e) {
			toast.error(message(e, 'Could not change the version'));
		}
	}

	let iconInput = $state<HTMLInputElement>();
	let iconBusy = $state(false);

	async function uploadIcon(file: File | undefined) {
		if (!file) return;
		iconBusy = true;
		try {
			const body = new FormData();
			body.set('file', file);
			const res = await fetch(`/modpacks/${id}/icon`, { method: 'POST', body });
			if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
			await loadedPack.refresh();
			toast.success('Icon changed');
		} catch (e) {
			toast.error(e instanceof Error && e.message ? e.message : 'Could not save the image');
		} finally {
			iconBusy = false;
			if (iconInput) iconInput.value = '';
		}
	}

	async function dropIcon() {
		iconBusy = true;
		try {
			await removePackIcon({ id });
		} catch (e) {
			toast.error(message(e, 'Could not remove the icon'));
		} finally {
			iconBusy = false;
		}
	}

	let name = $state('');
	let description = $state('');
	// load the saved values when the pack arrives or changes
	$effect(() => {
		const p = pack;
		if (!p) return;
		name = p.name;
		description = p.description;
	});
	const dirty = $derived(!!pack && (name !== pack.name || description !== pack.description));

	async function saveSettings() {
		try {
			await updateLocalPack({ id, name, description });
			toast.success('Saved');
		} catch (e) {
			toast.error(message(e, 'Could not save'));
		}
	}

	let nextMc = $state('');
	const versions = $derived(pack ? packMinecraftVersions(pack.loader) : null);
	const mcOptions = $derived((versions?.current ?? []).map((v) => ({ value: v, label: v })));
	const change = $derived(
		nextMc && pack && nextMc !== pack.mcVersion
			? previewPackVersionChange({ id, mcVersion: nextMc })
			: null
	);
	let applying = $state(false);

	async function applyChange(dropIncompatible: boolean) {
		applying = true;
		try {
			const result = await applyPackVersionChange({ id, mcVersion: nextMc, dropIncompatible });
			toast.success(
				`Now on Minecraft ${nextMc}: ${result.updated} updated${result.removed ? `, ${result.removed} removed` : ''}`
			);
			nextMc = '';
		} catch (e) {
			toast.error(message(e, 'Could not change the version'));
		} finally {
			applying = false;
		}
	}

	let nextBuild = $state('');
	const builds = $derived(pack ? packLoaderBuilds({ id }) : null);
	const buildOptions = $derived(
		(builds?.current ?? []).map((b, i) => ({
			value: b,
			label: i === 0 ? `${b} (newest)` : b
		}))
	);
	let savingBuild = $state(false);

	async function saveBuild() {
		savingBuild = true;
		try {
			await setPackLoaderVersion({ id, loaderVersion: nextBuild });
			toast.success(`Now on ${pack.loader} ${nextBuild}`);
			nextBuild = '';
		} catch (e) {
			toast.error(message(e, 'Could not change the loader version'));
		} finally {
			savingBuild = false;
		}
	}

	async function removePack() {
		deleting = false;
		try {
			await deleteLocalPack({ id });
			toast.success('Pack deleted');
			await goto('/modpacks');
		} catch (e) {
			toast.error(message(e, 'Could not delete the pack'));
		}
	}
</script>

<svelte:head><title>{pack.name ?? 'Modpack'} · Minecrafty</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
	<div class="flex items-start gap-2">
		<Button
			variant="ghost"
			size="icon"
			href="/modpacks"
			aria-label="Back to modpacks"
			class="mt-0.5"
		>
			<ArrowLeftIcon />
		</Button>
		{#if pack}
			<InstanceIcon loader={pack.loader} packIconUrl={pack.iconUrl} class="mt-0.5 size-10" />
		{/if}
		<div class="min-w-0 flex-1">
			<PageHeader title={pack.name ?? ''} description={pack.description || undefined}>
				{#snippet badge()}
					{#if pack}
						<LoaderBadge loader={pack.loader} version={pack.loaderVersion} />
						<Badge variant="muted">Minecraft {pack.mcVersion}</Badge>
						<Badge variant="muted">revision {pack.revision}</Badge>
					{/if}
				{/snippet}
				{#snippet actions()}
					<Button variant="outline" href="/modpacks/{id}/export" data-sveltekit-reload>
						<DownloadIcon />Download .mrpack
					</Button>
					{#if canMakeServer}
						<Button onclick={() => (makingServer = true)}><ServerIcon />Make a server</Button>
					{/if}
				{/snippet}
			</PageHeader>
		</div>
	</div>

	{#if pack}
		<nav class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Pack sections">
			{#each sections as section (section.name)}
				<Button
					variant={tab === section.name ? 'secondary' : 'ghost'}
					size="sm"
					href="?tab={section.name}"
					aria-current={tab === section.name ? 'page' : undefined}
					data-sveltekit-replacestate
				>
					<section.icon />{section.label}
					{#if section.count !== undefined}
						<Badge variant="muted" class="tabular-nums">{section.count}</Badge>
					{/if}
				</Button>
			{/each}
		</nav>

		{#if tab === 'mods'}
			<Tabs.Root
				value={view}
				onValueChange={(value) => (params.view = value as (typeof VIEWS)[number])}
			>
				<Tabs.List>
					<Tabs.Trigger value="installed"
						>Installed <Badge variant="muted" class="tabular-nums">{pack.files.length}</Badge
						></Tabs.Trigger
					>
					{#if canWrite}<Tabs.Trigger value="browse">Browse</Tabs.Trigger>{/if}
				</Tabs.List>
			</Tabs.Root>
		{/if}

		<!-- the header and tabs stay put; the active tab scrolls inside this. Rows are max-content: cards clip their own overflow, so with auto
		     rows they would shrink to fit this box instead of letting it scroll. The padding and matching
		     negative margin leave room for a card's ring, which a scroll container would clip. -->
		<div
			class={cn(
				'-m-1 grid min-h-0 flex-1 auto-rows-max content-start gap-4 overflow-y-auto p-1',
				// the only row is the config editor, which fills the height
				tab === 'configs' && 'grid-rows-1',
				// the mods card grows to its rows, up to the height left, then scrolls its own list
				tab === 'mods' && 'flex flex-col'
			)}
		>
			{#if tab === 'mods'}
				{#if view === 'installed'}
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
									? (mod) => {
											picker = {
												projectId: mod.projectId!,
												title: mod.title,
												fileId: mod.id,
												versionId: mod.versionId ?? ''
											};
											pickerOpen = true;
										}
									: undefined}
								onRemove={canWrite ? (mod) => remove(mod.id, mod.title) : undefined}
								onBrowse={canWrite ? () => (params.view = 'browse') : undefined}
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
			{:else if tab === 'settings' && canWrite}
				<Card.Root>
					<Card.Header>
						<Card.Title>Details</Card.Title>
					</Card.Header>
					<Card.Content class="grid max-w-xl gap-4">
						<Field.Field>
							<Field.Label for="pack-name">Name</Field.Label>
							<Input id="pack-name" bind:value={name} maxlength={60} autocomplete="off" />
						</Field.Field>
						<Field.Field>
							<Field.Label for="pack-description">Description</Field.Label>
							<Input
								id="pack-description"
								bind:value={description}
								maxlength={500}
								autocomplete="off"
							/>
						</Field.Field>
						<div>
							<Button disabled={!dirty || !name.trim()} onclick={saveSettings}>Save</Button>
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title>Icon</Card.Title>
						<Card.Description>
							Shown for this pack and for the servers made from it. A PNG, JPEG or WebP of at most 2
							MB, ideally square. It is not part of the downloaded .mrpack.
						</Card.Description>
					</Card.Header>
					<Card.Content class="flex flex-wrap items-center gap-4">
						<InstanceIcon loader={pack.loader} packIconUrl={pack.iconUrl} class="size-16" />
						<input
							bind:this={iconInput}
							type="file"
							accept="image/png,image/jpeg,image/webp"
							class="hidden"
							onchange={(e) => uploadIcon(e.currentTarget.files?.[0])}
						/>
						<div class="flex gap-2">
							<Button variant="outline" loading={iconBusy} onclick={() => iconInput?.click()}>
								<UploadIcon />{pack.iconUrl ? 'Change image' : 'Upload image'}
							</Button>
							{#if pack.iconUrl}
								<Button variant="ghost" disabled={iconBusy} onclick={dropIcon}>Remove</Button>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title>Minecraft version</Card.Title>
						<Card.Description>
							Pick another version to see which mods carry over. It only changes once you apply it.
						</Card.Description>
					</Card.Header>
					<Card.Content class="grid max-w-xl gap-4">
						<Combobox
							options={mcOptions}
							bind:value={nextMc}
							placeholder="Currently {pack.mcVersion}"
						/>
						{#if change}
							{#if change.loading && !change.current}
								<p class="text-sm text-muted-foreground">Checking each mod…</p>
							{:else if change.error}
								<p class="text-sm text-destructive" role="alert">Could not check that version.</p>
							{:else if change.current}
								<div class="grid gap-2 text-sm">
									<p>
										{change.current.compatible.length} of {pack.files.length} mods have a version for
										{nextMc}.
									</p>
									{#if change.current.unchecked}
										<p class="text-muted-foreground">
											{change.current.unchecked} files are not from Modrinth and are left as they are.
										</p>
									{/if}
									{#if change.current.incompatible.length}
										<div class="grid gap-1 rounded-lg border border-warning/40 p-3">
											<p class="font-medium">No version for {nextMc}:</p>
											<ul class="list-inside list-disc text-muted-foreground">
												{#each change.current.incompatible as mod (mod.id)}<li>
														{mod.title}
													</li>{/each}
											</ul>
										</div>
									{/if}
								</div>
								<div class="flex flex-wrap gap-2">
									{#if change.current.incompatible.length}
										<Button
											variant="destructive"
											loading={applying}
											onclick={() => applyChange(true)}
										>
											Remove those and change
										</Button>
									{:else}
										<Button loading={applying} onclick={() => applyChange(false)}
											>Change to {nextMc}</Button
										>
									{/if}
									<Button variant="ghost" onclick={() => (nextMc = '')}>Cancel</Button>
								</div>
							{/if}
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title>Loader version</Card.Title>
						<Card.Description>
							The {pack.loader} build servers made from this pack install. Changing the Minecraft version
							moves it to that version's newest build.
						</Card.Description>
					</Card.Header>
					<Card.Content class="grid max-w-xl gap-4">
						{#if builds?.error}
							<p class="text-sm text-destructive" role="alert">Could not load the builds.</p>
						{:else}
							<Combobox
								options={buildOptions}
								bind:value={nextBuild}
								placeholder="Currently {pack.loaderVersion ?? 'none'}"
							/>
						{/if}
						{#if nextBuild && nextBuild !== pack.loaderVersion}
							<div class="flex flex-wrap gap-2">
								<Button loading={savingBuild} onclick={saveBuild}>Use {nextBuild}</Button>
								<Button variant="ghost" onclick={() => (nextBuild = '')}>Cancel</Button>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title>Delete pack</Card.Title>
						<Card.Description
							>Removes the pack and its config files. Servers made from it are not touched.</Card.Description
						>
					</Card.Header>
					<Card.Footer>
						<Button variant="destructive" onclick={() => (deleting = true)}>Delete pack</Button>
					</Card.Footer>
				</Card.Root>
			{/if}
			<PackConfigs
				{id}
				files={pack.overrides}
				{canWrite}
				class={cn('h-full', tab === 'configs' ? '' : 'hidden')}
			/>
		</div>
	{/if}
</div>

{#if picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		kind="pack"
		instanceId={id}
		projectId={picker.projectId}
		title={picker.title}
		noun="mod"
		currentVersionId={picker.versionId}
		onSelect={repin}
	/>
{/if}

{#if pack}
	<MakeServerDialog bind:open={makingServer} packId={id} packName={pack.name} />
{/if}

<AlertDialog.Root bind:open={deleting}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {pack.name}?</AlertDialog.Title>
			<AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={removePack}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
