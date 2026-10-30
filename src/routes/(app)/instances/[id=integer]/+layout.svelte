<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import SkullIcon from '@tabler/icons-svelte/icons/skull';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { instanceModules, type InstanceModule } from '#lib/instance-modules.js';
	import { MODULE_PERMISSION, firstAllowedModule } from '#lib/permissions.js';
	import {
		getInstance,
		killInstance,
		listInstances,
		restartInstance,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import { liveStats } from '#lib/stats.remote.js';
	import { formatBytes, formatDuration, formatPercent } from '#lib/format.js';
	import StatusPill from '#lib/components/status-pill.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import type { LayoutProps } from './$types';
	import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
	import PlayerStopFilledIcon from '@tabler/icons-svelte/icons/player-stop-filled';
	import PlayerPlayFilledIcon from '@tabler/icons-svelte/icons/player-play-filled';
	import RefreshIcon from '@tabler/icons-svelte/icons/refresh';

	let { children }: LayoutProps = $props();

	let confirmKill = $state(false);

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const instance = $derived(await getInstance(id));
	const all = listInstances();
	const row = $derived(all.current?.find((i) => i.id === id));
	const status = $derived(row?.state ?? 'stopped');

	// what the running server is using, a few seconds old
	const live = liveStats();
	const mine = $derived(status === 'running' ? live.current?.instances[id] : undefined);
	const usage = $derived(
		[
			mine?.cpu != null ? `CPU ${formatPercent(mine.cpu)}` : null,
			mine?.rss != null ? `${formatBytes(mine.rss)} memory` : null,
			mine?.uptimeMs != null ? `up ${formatDuration(mine.uptimeMs)}` : null,
			mine?.players
				? `${mine.players.count}${mine.players.max ? ` of ${mine.players.max}` : ''} players`
				: null
		]
			.filter(Boolean)
			.join(' · ')
	);
	const installState = $derived(row?.installState ?? 'ready');
	const active = $derived(status === 'running' || status === 'stopping');
	// the Modpack tab only makes sense for a server created from a modpack
	const granted = $derived(instance?.permissions ?? []);
	const canControl = $derived(granted.includes('control'));
	const modules = $derived(
		instanceModules.filter(
			(m) =>
				(m.slug !== 'modpack' || !!instance?.packProjectId) &&
				granted.includes(MODULE_PERMISSION[m.slug])
		)
	);
	const slug = $derived(page.url.pathname.split('/')[3]);
	// a link to a tab the user may not open goes to the first one they may
	$effect(() => {
		if (!instance || !slug || modules.some((m) => m.slug === slug)) return;
		const first = firstAllowedModule(
			granted,
			modules.map((m) => m.slug)
		);
		if (first && first !== slug) void goto(`/instances/${id}/${first}`, { replaceState: true });
	});
	const labelOf = (m: InstanceModule) =>
		m.slug === 'mods' && instance?.loader && ['paper', 'purpur'].includes(instance.loader)
			? 'Plugins'
			: m.title;
	const startHint = $derived(
		installState === 'installing'
			? 'Installing…'
			: installState === 'failed'
				? 'Install failed'
				: 'Start the server'
	);

	async function run(action: (id: number) => Promise<void>) {
		try {
			await action(id);
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Action failed');
		}
	}
</script>

<svelte:head><title>{instance?.name ?? 'Instance'} · Minecrafty</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
	<div class="flex items-start gap-2">
		<Button
			variant="ghost"
			size="icon"
			href="/instances"
			aria-label="Back to instances"
			class="mt-0.5"
		>
			<ArrowLeftIcon />
		</Button>
		<div class="min-w-0 flex-1">
			<PageHeader
				title={instance?.name ?? ''}
				description={instance
					? `${instance.loader} ${instance.mcVersion} · port ${instance.port}${usage ? ` · ${usage}` : ''}`
					: undefined}
			>
				{#snippet badge()}<StatusPill state={status} />{/snippet}
				{#snippet actions()}
					{#if canControl}
						<ButtonGroup.Root>
							{#if !active}
								{@render action({
									label: 'Start',
									tip: startHint,
									icon: PlayerPlayFilledIcon,
									tone: 'success',
									disabled: installState !== 'ready',
									run: () => run(startInstance)
								})}
							{:else}
								{@render action({
									label: 'Restart',
									tip: 'Stop the server, then start it again',
									icon: RefreshIcon,
									disabled: status === 'stopping',
									run: () => run(restartInstance)
								})}
							{/if}
							{@render action({
								label: 'Stop',
								tip: 'Stop the server and save the world',
								icon: PlayerStopFilledIcon,
								tone: 'warning',
								disabled: !active || status === 'stopping',
								run: () => run(stopInstance)
							})}
							{@render action({
								label: 'Kill',
								tip: 'Kill the process now. Unsaved progress is lost',
								icon: SkullIcon,
								tone: 'danger',
								disabled: !active,
								run: async () => void (confirmKill = true)
							})}
						</ButtonGroup.Root>
					{/if}
				{/snippet}
			</PageHeader>
		</div>
	</div>

	<nav class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Instance modules">
		{#each modules as m (m.slug)}
			<Button
				variant={slug === m.slug ? 'secondary' : 'ghost'}
				size="sm"
				href="/instances/{id}/{m.slug}"
				aria-current={slug === m.slug ? 'page' : undefined}
			>
				<m.icon />{labelOf(m)}
			</Button>
		{/each}
	</nav>

	<!-- header and tabs stay put; the active module fills the rest and scrolls inside it. The
	     padding and matching negative margin leave room for a card's 1px ring, which a scroll
	     container would otherwise clip along its edges. -->
	<div class="-m-1 flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
		{#if modules.some((m) => m.slug === slug)}
			{@render children()}
		{/if}
	</div>
</div>

{#snippet action(a: {
	label: string;
	tip: string;
	icon: typeof SkullIcon;
	tone?: 'success' | 'warning' | 'danger';
	disabled?: boolean;
	run: () => Promise<void>;
})}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					class={a.tone === 'success'
						? 'text-success'
						: a.tone === 'warning'
							? 'text-warning'
							: a.tone === 'danger'
								? 'text-danger'
								: undefined}
					variant="outline"
					size="icon"
					aria-label={a.label}
					disabled={a.disabled}
					onClickPromise={a.run}
				>
					<a.icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{a.tip}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<AlertDialog.Root bind:open={confirmKill}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Kill {instance?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				The process ends immediately and progress since the last save is lost. Use Stop to shut down
				safely.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={() => run(killInstance)}>
				Kill
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
