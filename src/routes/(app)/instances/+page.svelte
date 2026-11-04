<script lang="ts">
	import DotsIcon from '@tabler/icons-svelte/icons/dots';
	import PlayerPlayFilledIcon from '@tabler/icons-svelte/icons/player-play-filled';
	import PlayerStopFilledIcon from '@tabler/icons-svelte/icons/player-stop-filled';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import SkullIcon from '@tabler/icons-svelte/icons/skull';
	import TerminalIcon from '@tabler/icons-svelte/icons/terminal-2';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import { toast } from 'svelte-sonner';
	import { prefersReducedMotion } from 'svelte/motion';
	import { SvelteSet } from 'svelte/reactivity';

	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import NewInstanceSheet from '#lib/components/new-instance/new-instance-sheet.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import StatusPill from '#lib/components/status-pill.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { formatBytes } from '#lib/format.js';
	import { canRetryInstall } from '#lib/instance-origin.js';
	import {
		deleteInstance,
		killInstance,
		listInstances,
		refreshPackIcons,
		retryInstall,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import { liveInstances } from '#lib/live.svelte.js';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const canCreate = $derived(data.panel.includes('instances.create'));
	const canDelete = $derived(data.panel.includes('instances.delete'));
	const first = await listInstances();
	const liveRows = liveInstances();
	const instances = $derived(liveRows.current ?? first);

	// modpack servers made before their icon was kept get it from Modrinth, once
	let askedIcons = false;
	$effect(() => {
		if (askedIcons || !instances.some((i) => i.packProjectId && !i.packIconUrl)) return;
		askedIcons = true;
		void refreshPackIcons().catch(() => undefined);
	});

	// a download shows sizes, anything else a count of steps
	const progressDetail = (p: { done: number; total: number; bytes?: boolean } | null) =>
		!p
			? ''
			: p.bytes
				? p.total > 0
					? ` · ${formatBytes(p.done)} of ${formatBytes(p.total)}`
					: ` · ${formatBytes(p.done)}`
				: p.total > 1
					? ` · ${p.done}/${p.total}`
					: '';

	// a step without counts (installing, getting Java) gets a moving bar, not an empty one
	const counted = (p: { done: number; total: number; bytes?: boolean } | null) =>
		!!p && (p.bytes ? p.total > 0 : p.total > 1);

	// When an install finishes the card would flip to its buttons before the bar reaches the end.
	// It stays an installing card for a moment, the bar filling up, then hands over.
	const SETTLE_MS = 1400;
	const settling = new SvelteSet<number>();
	let wasInstalling = new Set<number>();
	$effect(() => {
		const now = new Set(instances.filter((i) => i.installState === 'installing').map((i) => i.id));
		for (const id of wasInstalling) {
			const inst = instances.find((i) => i.id === id);
			if (now.has(id) || inst?.installState !== 'ready') continue;
			if (prefersReducedMotion.current) continue;
			settling.add(id);
			setTimeout(() => settling.delete(id), SETTLE_MS);
		}
		wasInstalling = now;
	});

	let createOpen = $state(false);
	let killing = $state<{ id: number; name: string }>({ id: 0, name: '' });
	let killOpen = $state(false);
	const askKill = (inst: { id: number; name: string }) => {
		killing = { id: inst.id, name: inst.name };
		killOpen = true;
	};

	let deleting = $state<{ id: number; name: string }>({ id: 0, name: '' });
	let deleteOpen = $state(false);
	const askDelete = (inst: { id: number; name: string }) => {
		deleting = inst;
		deleteOpen = true;
	};

	async function run(action: (id: number) => Promise<void>, id: number) {
		try {
			await action(id);
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Action failed');
		}
	}
</script>

<svelte:head><title>Instances · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader title="Instances" description="Create and manage your Minecraft servers.">
		{#snippet actions()}
			{#if canCreate}
				<Button onclick={() => (createOpen = true)}><PlusIcon />New instance</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if !instances.length}
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Media variant="icon"><ServerIcon /></Empty.Media>
				<Empty.Title>No instances yet</Empty.Title>
				<Empty.Description>
					{canCreate
						? 'Create your first server to get started.'
						: 'The owner can give you access to one.'}
				</Empty.Description>
			</Empty.Header>
			{#if canCreate}
				<Empty.Content>
					<Button onclick={() => (createOpen = true)}><PlusIcon />New instance</Button>
				</Empty.Content>
			{/if}
		</Empty.Root>
	{/if}

	<div class="grid gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3">
		{#each instances ?? [] as inst (inst.id)}
			{@const settled = settling.has(inst.id) && inst.installState === 'ready'}
			{@const installing = inst.installState === 'installing' || settled}
			{@const failed = inst.installState === 'failed'}
			{@const active = inst.state === 'running' || inst.state === 'stopping'}
			{@const progress = inst.progress}
			<Card.Root>
				<Card.Header>
					<div class="flex min-w-0 items-center gap-3">
						<InstanceIcon loader={inst.loader} packIconUrl={inst.packIconUrl} />
						<div class="grid min-w-0 gap-1">
							<Card.Title class="truncate">{inst.name}</Card.Title>
							<Card.Description>
								{inst.loader}
								{inst.mcVersion} · port {inst.port} · {inst.ramMaxMb} MB
							</Card.Description>
						</div>
					</div>
					<Card.Action>
						<StatusPill state={installing ? 'installing' : failed ? 'failed' : inst.state} />
					</Card.Action>
				</Card.Header>
				{#if failed}
					<Card.Content>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<p {...props} class="line-clamp-2 text-sm text-destructive" role="alert">
										{inst.installMessage ?? 'The install failed.'}
									</p>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content class="max-w-sm">
								{inst.installMessage ?? 'The install failed.'}
							</Tooltip.Content>
						</Tooltip.Root>
					</Card.Content>
				{/if}
				<Card.Footer class="flex min-h-6 flex-wrap items-center gap-2">
					{#if installing}
						<div class="grid w-full gap-1">
							<p class="truncate text-xs text-muted-foreground">
								{settled ? 'Installed' : (progress?.label ?? 'Starting')}{settled
									? ''
									: progressDetail(progress)}
							</p>
							<Progress
								value={settled ? 1 : counted(progress) ? progress!.done : null}
								max={settled ? 1 : counted(progress) ? progress!.total : 1}
							/>
						</div>
					{:else}
						{@const control = inst.permissions.includes('control')}
						{@const killable = !failed && active}
						{@const removable = failed || !active}
						{#if failed}
							{#if canRetryInstall(inst) && inst.permissions.includes('settings')}
								<Button size="sm" onClickPromise={() => run(retryInstall, inst.id)}>
									<RefreshIcon />Retry
								</Button>
							{/if}
						{:else}
							{#if control && active}
								<Button
									variant="outline"
									size="sm"
									disabled={inst.state === 'stopping'}
									onClickPromise={() => run(stopInstance, inst.id)}
								>
									<PlayerStopFilledIcon />Stop
								</Button>
							{:else if control}
								<Button size="sm" onClickPromise={() => run(startInstance, inst.id)}>
									<PlayerPlayFilledIcon />Start
								</Button>
							{/if}
							<Button variant="ghost" size="sm" href="/instances/{inst.id}">
								<TerminalIcon />Console
							</Button>
						{/if}
						{#if control || canDelete}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-sm"
											class="ms-auto"
											aria-label="More for {inst.name}"
										>
											<DotsIcon />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="min-w-32">
									<!-- what the state rules out stays visible, greyed, with what to do; what a role rules out is hidden -->
									{#if control}
										{@render menuItem(
											'Kill',
											SkullIcon,
											killable ? '' : 'The server is not running',
											() => askKill(inst)
										)}
									{/if}
									{#if canDelete}
										{@render menuItem(
											'Delete',
											TrashIcon,
											removable ? '' : 'Stop the server first',
											() => askDelete(inst)
										)}
									{/if}
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{/if}
					{/if}
				</Card.Footer>
			</Card.Root>
		{/each}
	</div>
</div>

<!-- a dangerous menu item; with a `blocked` reason it is disabled and says why on hover -->
{#snippet menuItem(label: string, Icon: typeof TrashIcon, blocked: string, onSelect: () => void)}
	{#if blocked}
		<!-- the wrapper carries the title, since a disabled item ignores the pointer -->
		<div title={blocked}>
			<DropdownMenu.Item variant="destructive" disabled><Icon />{label}</DropdownMenu.Item>
		</div>
	{:else}
		<DropdownMenu.Item variant="destructive" {onSelect}><Icon />{label}</DropdownMenu.Item>
	{/if}
{/snippet}

<NewInstanceSheet bind:open={createOpen} canUsePacks={data.panel.includes('modpacks.read')} />

<AlertDialog.Root bind:open={killOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Kill {killing.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				The process ends immediately and progress since the last save is lost. Use Stop to shut down
				safely.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					killOpen = false;
					run(killInstance, killing.id);
				}}
			>
				Kill
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {deleting.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently removes the instance and its world files.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					const id = deleting.id;
					deleteOpen = false;
					run(deleteInstance, id);
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
