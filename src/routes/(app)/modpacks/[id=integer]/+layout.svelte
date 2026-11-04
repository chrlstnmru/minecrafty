<!-- A pack made in the builder: its header, the section nav, and the open section below them. -->
<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import FileCodeIcon from '@tabler/icons-svelte/icons/file-code';
	import PackageIcon from '@tabler/icons-svelte/icons/package';
	import PaletteIcon from '@tabler/icons-svelte/icons/palette';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import SettingsIcon from '@tabler/icons-svelte/icons/settings';

	import CountBadge from '#lib/components/count-badge.svelte';
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import LoaderBadge from '#lib/components/loader-badge.svelte';
	import MakeServerDialog from '#lib/components/make-server-dialog.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getLocalPack } from '#lib/modpacks/builder.remote.js';
	import { isResourcePack } from '#lib/modpacks/pack-files.js';

	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const pack = $derived(await getLocalPack({ id }));
	const canWrite = $derived(data.panel.includes('modpacks.write'));
	const canMakeServer = $derived(data.panel.includes('instances.create'));
	let makingServer = $state(false);

	const sections = $derived([
		{
			slug: 'mods',
			label: 'Mods',
			icon: PackageIcon,
			count: pack.files.filter((f) => !isResourcePack(f)).length
		},
		{
			slug: 'resource-packs',
			label: 'Resource packs',
			icon: PaletteIcon,
			count: pack.files.filter(isResourcePack).length + (pack.serverPackProjectId ? 1 : 0)
		},
		{ slug: 'configs', label: 'Configs', icon: FileCodeIcon, count: pack.overrides.length },
		...(canWrite ? [{ slug: 'settings', label: 'Settings', icon: SettingsIcon }] : [])
	] as { slug: string; label: string; icon: typeof PackageIcon; count?: number }[]);
	const slug = $derived(page.url.pathname.split('/')[3]);
	const section = $derived(sections.find((s) => s.slug === slug));
</script>

<svelte:head>
	<title>{[section?.label, pack.name, 'Minecrafty'].filter(Boolean).join(' · ')}</title>
</svelte:head>

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
		<InstanceIcon loader={pack.loader} packIconUrl={pack.iconUrl} class="mt-0.5 size-10" />
		<div class="min-w-0 flex-1">
			<PageHeader title={pack.name} description={pack.description || undefined}>
				{#snippet badge()}
					<LoaderBadge loader={pack.loader} version={pack.loaderVersion} />
					<Badge variant="muted">Minecraft {pack.mcVersion}</Badge>
					<Badge variant="muted">revision {pack.revision}</Badge>
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

	<nav class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Pack sections">
		{#each sections as s (s.slug)}
			<Button
				variant={slug === s.slug ? 'secondary' : 'ghost'}
				size="sm"
				href="/modpacks/{id}/{s.slug}"
				aria-current={slug === s.slug ? 'page' : undefined}
			>
				<s.icon />{s.label}
				{#if s.count !== undefined}<CountBadge count={s.count} />{/if}
			</Button>
		{/each}
	</nav>

	<!-- the header and nav stay put; the open section fills the rest and scrolls inside it. The padding
	     and matching negative margin leave room for a card's ring, which a scroll container would clip. -->
	<div class="-m-1 flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
		{@render children()}
	</div>
</div>

<MakeServerDialog bind:open={makingServer} packId={id} packName={pack.name} />
