<script lang="ts">
	import type { PageProps } from './$types';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
	import PlayerPlayFilledIcon from '@tabler/icons-svelte/icons/player-play-filled';
	import PlayerStopFilledIcon from '@tabler/icons-svelte/icons/player-stop-filled';
	import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import { toast } from 'svelte-sonner';
	import {
		listInstances,
		restartInstance,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import { liveStats, overviewNow } from '#lib/stats.remote.js';
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import Sparkline from '#lib/components/sparkline.svelte';
	import StatCard from '#lib/components/stat-card.svelte';
	import StatusPill from '#lib/components/status-pill.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { formatBytes, formatDuration, formatPercent } from '#lib/format.js';

	let { data }: PageProps = $props();
	const canCreate = $derived(data.panel.includes('instances.create'));
	const seesHost = $derived(data.panel.includes('host.view'));
	const instances = $derived(await listInstances());
	const live = liveStats();
	const stats = $derived(live.current);
	const overview = overviewNow();

	// the maintenance card changes by the minute at most
	$effect(() => {
		const timer = setInterval(() => void overviewNow().refresh(), 30_000);
		return () => clearInterval(timer);
	});

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	type Row = (typeof instances)[number] & {
		shown: string;
		cpu: number | null;
		rss: number | null;
		disk: number | null;
		players: number | null;
		maxPlayers: number | null;
		uptime: number | null;
	};

	const rows = $derived<Row[]>(
		instances.map((inst) => {
			const s = stats?.instances[inst.id];
			return {
				...inst,
				shown:
					inst.installState === 'installing'
						? 'installing'
						: inst.installState === 'failed'
							? 'failed'
							: inst.state,
				cpu: s?.cpu ?? null,
				rss: s?.rss ?? null,
				disk: s?.diskBytes ?? null,
				players: s?.players?.count ?? null,
				maxPlayers: s?.players?.max ?? null,
				uptime: s?.uptimeMs ?? null
			};
		})
	);

	const running = $derived(rows.filter((r) => r.state === 'running' || r.state === 'stopping'));
	const problems = $derived(rows.filter((r) => r.shown === 'failed' || r.shown === 'installing'));
	const playersOnline = $derived(running.reduce((n, r) => n + (r.players ?? 0), 0));
	const serversMemory = $derived(running.reduce((n, r) => n + (r.rss ?? 0), 0));

	let filter = $state('all');
	let sortKey = $state<'name' | 'status' | 'cpu' | 'rss' | 'disk' | 'players'>('name');
	let sortDown = $state(false);

	const filtered = $derived(
		rows.filter((r) =>
			filter === 'running'
				? r.state === 'running' || r.state === 'stopping'
				: filter === 'stopped'
					? r.shown === 'stopped' || r.shown === 'exited'
					: filter === 'problems'
						? r.shown === 'failed' || r.shown === 'installing'
						: true
		)
	);

	const sorted = $derived(
		filtered.toSorted((a, b) => {
			const value = (r: Row) =>
				sortKey === 'name'
					? r.name.toLowerCase()
					: sortKey === 'status'
						? r.shown
						: sortKey === 'cpu'
							? r.cpu
							: sortKey === 'rss'
								? r.rss
								: sortKey === 'disk'
									? r.disk
									: r.players;
			const x = value(a);
			const y = value(b);
			// a row with no number goes last whichever way it is sorted
			if (x === null && y === null) return 0;
			if (x === null) return 1;
			if (y === null) return -1;
			const order = x < y ? -1 : x > y ? 1 : 0;
			return sortDown ? -order : order;
		})
	);

	function sortBy(key: typeof sortKey) {
		if (sortKey === key) sortDown = !sortDown;
		else {
			sortKey = key;
			sortDown = key !== 'name' && key !== 'status';
		}
	}
	const ariaSort = (key: typeof sortKey) =>
		sortKey !== key ? 'none' : sortDown ? 'descending' : 'ascending';

	async function run(action: (id: number) => Promise<void>, id: number) {
		try {
			await action(id);
		} catch (e) {
			toast.error(message(e, 'Action failed'));
		}
	}

	const at = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
	const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	const memShare = $derived(stats ? (stats.host.memUsed / stats.host.memTotal) * 100 : 0);
	const diskUsed = $derived(stats ? stats.storage.total - stats.storage.free : 0);
	const diskShare = $derived(
		stats && stats.storage.total ? (diskUsed / stats.storage.total) * 100 : 0
	);
</script>

{#snippet sortable(key: 'name' | 'status' | 'cpu' | 'rss' | 'disk' | 'players', label: string)}
	<button
		type="button"
		class="inline-flex items-center gap-1 hover:text-foreground"
		onclick={() => sortBy(key)}
	>
		{label}
		{#if sortKey === key}
			{#if sortDown}<ArrowDownIcon class="size-3.5" />{:else}<ArrowUpIcon class="size-3.5" />{/if}
		{/if}
	</button>
{/snippet}

{#snippet action(
	label: string,
	tip: string,
	tone: string | undefined,
	run: () => Promise<void>,
	icon: typeof RefreshIcon
)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class={tone === 'success'
						? 'text-success'
						: tone === 'warning'
							? 'text-warning'
							: undefined}
					aria-label={label}
					onClickPromise={run}
				>
					{@const Icon = icon}
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{tip}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<svelte:head><title>Dashboard · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader title="Dashboard" description="How the host and your servers are doing right now." />

	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#if seesHost}
			<StatCard
				title="CPU"
				value={stats?.host.cpu != null ? formatPercent(stats.host.cpu) : '–'}
				hint={stats
					? `${stats.host.cores} cores · host up ${formatDuration(stats.host.uptime * 1000)}`
					: undefined}
			>
				<Sparkline values={stats?.history.cpu ?? []} class="text-info" />
			</StatCard>

			<StatCard
				title="Memory"
				value={stats ? `${gb(stats.host.memUsed)} of ${gb(stats.host.memTotal)}` : '–'}
				hint={stats ? `Servers use ${gb(serversMemory)}` : undefined}
			>
				<div class="grid gap-2">
					<Progress value={memShare} max={100} />
					<Sparkline
						values={stats?.history.mem.map((m) => (m / stats.host.memTotal) * 100) ?? []}
						class="text-success"
					/>
				</div>
			</StatCard>

			<StatCard
				title="Storage"
				value={stats ? `${formatBytes(diskUsed)} used` : '–'}
				hint={stats
					? `${formatBytes(stats.storage.free)} free · servers ${formatBytes(stats.storage.instances)} · backups ${formatBytes(stats.storage.backups)}`
					: undefined}
			>
				<Progress value={diskShare} max={100} />
			</StatCard>
		{/if}

		<StatCard
			title="Servers"
			value="{running.length} of {rows.length} running"
			hint={problems.length
				? `${problems.filter((r) => r.shown === 'installing').length} installing · ${problems.filter((r) => r.shown === 'failed').length} failed`
				: 'Nothing installing or failed'}
		/>

		<StatCard
			title="Players online"
			value={String(playersOnline)}
			hint={running.length
				? `Across ${running.length} running ${running.length === 1 ? 'server' : 'servers'}`
				: 'No server is running'}
		/>

		<StatCard
			title="Maintenance"
			value={overview.current?.nextTask
				? `Next task in ${formatDuration(overview.current.nextTask.at - Date.now())}`
				: 'No task scheduled'}
			hint={overview.current
				? [
						overview.current.nextTask
							? `${overview.current.nextTask.name} on ${overview.current.nextTask.instanceName}`
							: null,
						overview.current.lastBackup
							? `last backup ${at.format(overview.current.lastBackup.at)}`
							: 'no backups yet',
						overview.current.withoutBackup && overview.current.lastBackup
							? `${overview.current.withoutBackup} without one`
							: null
					]
						.filter(Boolean)
						.join(' · ')
				: undefined}
		/>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Servers</Card.Title>
			<Card.Action>
				<Tabs.Root bind:value={filter}>
					<Tabs.List>
						<Tabs.Trigger value="all">All ({rows.length})</Tabs.Trigger>
						<Tabs.Trigger value="running">Running ({running.length})</Tabs.Trigger>
						<Tabs.Trigger value="stopped">Stopped</Tabs.Trigger>
						{#if problems.length}<Tabs.Trigger value="problems"
								>Problems ({problems.length})</Tabs.Trigger
							>{/if}
					</Tabs.List>
				</Tabs.Root>
			</Card.Action>
		</Card.Header>
		<Card.Content class="px-0">
			{#if !rows.length}
				<div class="px-6">
					<Empty.Root class="border">
						<Empty.Header>
							<Empty.Media variant="icon"><ServerIcon /></Empty.Media>
							<Empty.Title>No servers yet</Empty.Title>
							<Empty.Description>
								{canCreate
									? 'Create your first one to see it here.'
									: 'An admin can give you access to one.'}
							</Empty.Description>
						</Empty.Header>
						<Empty.Content>
							<Button size="sm" href="/instances">Go to Instances</Button>
						</Empty.Content>
					</Empty.Root>
				</div>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="ps-6" aria-sort={ariaSort('name')}
								>{@render sortable('name', 'Server')}</Table.Head
							>
							<Table.Head aria-sort={ariaSort('status')}
								>{@render sortable('status', 'Status')}</Table.Head
							>
							<Table.Head class="text-end" aria-sort={ariaSort('cpu')}
								>{@render sortable('cpu', 'CPU')}</Table.Head
							>
							<Table.Head class="text-end" aria-sort={ariaSort('rss')}
								>{@render sortable('rss', 'Memory')}</Table.Head
							>
							<Table.Head class="text-end" aria-sort={ariaSort('disk')}
								>{@render sortable('disk', 'Disk')}</Table.Head
							>
							<Table.Head class="text-end" aria-sort={ariaSort('players')}
								>{@render sortable('players', 'Players')}</Table.Head
							>
							<Table.Head class="pe-6 text-end"><span class="sr-only">Actions</span></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each sorted as row (row.id)}
							<Table.Row>
								<Table.Cell class="ps-6">
									<a
										href="/instances/{row.id}"
										class="flex min-w-0 items-center gap-3 hover:underline"
									>
										<InstanceIcon loader={row.loader} packIconUrl={row.packIconUrl} />
										<span class="grid min-w-0">
											<span class="truncate text-sm font-medium">{row.name}</span>
											<span class="truncate text-xs text-muted-foreground">
												{row.loader}
												{row.mcVersion}{row.uptime !== null
													? ` · up ${formatDuration(row.uptime)}`
													: ''}
											</span>
										</span>
									</a>
								</Table.Cell>
								<Table.Cell><StatusPill state={row.shown} /></Table.Cell>
								<Table.Cell class="text-end tabular-nums"
									>{row.cpu !== null ? formatPercent(row.cpu) : '–'}</Table.Cell
								>
								<Table.Cell class="text-end tabular-nums"
									>{row.rss !== null ? formatBytes(row.rss) : '–'}</Table.Cell
								>
								<Table.Cell class="text-end tabular-nums"
									>{row.disk !== null ? formatBytes(row.disk) : '–'}</Table.Cell
								>
								<Table.Cell class="text-end tabular-nums">
									{row.players !== null
										? `${row.players}${row.maxPlayers ? ` / ${row.maxPlayers}` : ''}`
										: '–'}
								</Table.Cell>
								<Table.Cell class="pe-6">
									<div class="flex justify-end">
										{#if !row.permissions.includes('control')}
											<!-- viewing only -->
										{:else if row.state === 'running'}
											{@render action(
												`Restart ${row.name}`,
												'Stop, then start again',
												undefined,
												() => run(restartInstance, row.id),
												RefreshIcon
											)}
											{@render action(
												`Stop ${row.name}`,
												'Stop and save the world',
												'warning',
												() => run(stopInstance, row.id),
												PlayerStopFilledIcon
											)}
										{:else if row.state !== 'stopping' && row.installState === 'ready'}
											{@render action(
												`Start ${row.name}`,
												'Start the server',
												'success',
												() => run(startInstance, row.id),
												PlayerPlayFilledIcon
											)}
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={7} class="py-8 text-center text-sm text-muted-foreground">
									No server matches this filter.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
