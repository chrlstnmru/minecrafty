<script lang="ts">
	import type { PageProps } from './$types';
	import { prefersReducedMotion } from 'svelte/motion';
	import { SvelteSet } from 'svelte/reactivity';
	import PageHeader from '#lib/components/page-header.svelte';
	import { toast } from 'svelte-sonner';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import {
		deleteInstance,
		killInstance,
		listInstances,
		refreshPackIcons,
		retryInstall,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import { formatBytes } from '#lib/format.js';
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import NewInstanceSheet from '#lib/components/new-instance/new-instance-sheet.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import StatusPill from '#lib/components/status-pill.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	let { data }: PageProps = $props();
	const canCreate = $derived(data.panel.includes('instances.create'));
	const canDelete = $derived(data.panel.includes('instances.delete'));
	const instances = $derived(await listInstances());

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
						: 'An admin can give you access to one.'}
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
				{#if installing}
					<Card.Content class="grid gap-2">
						<Progress
							value={settled ? 1 : progress ? progress.done : 0}
							max={settled ? 1 : Math.max(progress?.total ?? 1, 1)}
						/>
						<p class="text-xs text-muted-foreground">
							{settled ? 'Installed' : (progress?.label ?? 'Starting')}{settled
								? ''
								: progressDetail(progress)}
						</p>
					</Card.Content>
				{:else if failed}
					<Card.Content>
						<p class="text-sm text-destructive" role="alert">
							{inst.installMessage ?? 'The install failed.'}
						</p>
					</Card.Content>
				{/if}
				<Card.Footer class="flex flex-wrap gap-2">
					{#if installing}
						<p class="text-xs text-muted-foreground">
							{settled ? 'Ready to start.' : 'You can leave this page; the install keeps going.'}
						</p>
					{:else if failed}
						{#if !inst.packProjectId && inst.permissions.includes('settings')}
							<Button variant="outline" size="sm" onClickPromise={() => run(retryInstall, inst.id)}>
								Retry
							</Button>
						{/if}
						{#if canDelete}
							<Button variant="destructive" size="sm" onclick={() => askDelete(inst)}>Delete</Button
							>
						{/if}
					{:else}
						<Button variant="secondary" size="sm" href="/instances/{inst.id}">Console</Button>
						{#if !inst.permissions.includes('control')}
							<!-- viewing only -->
						{:else if active}
							<Button
								variant="outline"
								size="sm"
								disabled={inst.state === 'stopping'}
								onClickPromise={() => run(stopInstance, inst.id)}
							>
								Stop
							</Button>
							<Button
								variant="destructive"
								size="sm"
								onClickPromise={() => run(killInstance, inst.id)}
							>
								Kill
							</Button>
						{:else}
							<Button size="sm" onClickPromise={() => run(startInstance, inst.id)}>Start</Button>
							{#if canDelete}
								<Button variant="ghost" size="sm" onclick={() => askDelete(inst)}>Delete</Button>
							{/if}
						{/if}
					{/if}
				</Card.Footer>
			</Card.Root>
		{/each}
	</div>
</div>

<NewInstanceSheet bind:open={createOpen} />

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
