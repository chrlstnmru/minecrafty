<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import SkullIcon from '@tabler/icons-svelte/icons/skull';
	import { toast } from 'svelte-sonner';
	import { instanceModules } from '#lib/instance-modules.js';
	import {
		getInstance,
		killInstance,
		listInstances,
		restartInstance,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
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
	const installState = $derived(row?.installState ?? 'ready');
	const active = $derived(status === 'running' || status === 'stopping');
	const startHint = $derived(
		installState === 'installing'
			? 'Installing…'
			: installState === 'failed'
				? 'Install failed'
				: 'Start the server'
	);
	const slug = $derived(page.url.pathname.split('/')[3]);

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
	<div class="flex flex-wrap items-center gap-3">
		<Button variant="ghost" size="icon" href="/instances" aria-label="Back to instances">
			<ArrowLeftIcon />
		</Button>
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-2">
				<h2 class="truncate text-lg font-semibold">{instance?.name ?? ''}</h2>
				<StatusPill state={status} />
			</div>
			{#if instance}
				<p class="text-sm text-muted-foreground">
					{instance.loader}
					{instance.mcVersion} · port {instance.port}
				</p>
			{/if}
		</div>
		<ButtonGroup.Root>
			{#if !active}
				{@render action({
					label: 'Start',
					tip: startHint,
					icon: PlayerPlayFilledIcon,
					tone: 'text-success',
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
				{@render action({
					label: 'Stop',
					tip: 'Stop the server and save the world',
					icon: PlayerStopFilledIcon,
					tone: 'text-warning',
					disabled: status === 'stopping',
					run: () => run(stopInstance)
				})}
				{@render action({
					label: 'Kill',
					tip: 'Kill the process now. Unsaved progress is lost',
					icon: SkullIcon,
					tone: 'text-danger',
					run: async () => void (confirmKill = true)
				})}
			{/if}
		</ButtonGroup.Root>
	</div>

	<nav class="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Instance modules">
		{#each instanceModules as m (m.slug)}
			<Button
				variant={slug === m.slug ? 'secondary' : 'ghost'}
				size="sm"
				href="/instances/{id}/{m.slug}"
				aria-current={slug === m.slug ? 'page' : undefined}
				class={m.planned ? 'text-muted-foreground' : ''}
			>
				<m.icon />{m.slug === 'mods' &&
				instance.loader &&
				['paper', 'purpur'].includes(instance.loader)
					? 'Plugins'
					: m.title}
			</Button>
		{/each}
	</nav>

	<!-- header and tabs stay put; the active module fills the rest and scrolls inside it. The
	     padding and matching negative margin leave room for a card's 1px ring, which a scroll
	     container would otherwise clip along its edges. -->
	<div class="-m-1 flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
		{@render children()}
	</div>
</div>

{#snippet action(a: {
	label: string;
	tip: string;
	icon: typeof SkullIcon;
	tone?: string;
	disabled?: boolean;
	run: () => Promise<void>;
})}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					class={a.tone}
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
