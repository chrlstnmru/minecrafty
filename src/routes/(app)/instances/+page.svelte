<script lang="ts">
	import { toast } from 'svelte-sonner';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import {
		deleteInstance,
		killInstance,
		listInstances,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import NewInstanceSheet from '#lib/components/new-instance/new-instance-sheet.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import StatusPill from '#lib/components/status-pill.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	const instances = $derived(await listInstances());

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
	<div class="flex items-center justify-between">
		<p class="text-sm text-muted-foreground">Create and manage your Minecraft servers.</p>
		<Button onclick={() => (createOpen = true)}><PlusIcon />New instance</Button>
	</div>

	{#if !instances.length}
		<Empty.Root class="border">
			<Empty.Header>
				<Empty.Media variant="icon"><ServerIcon /></Empty.Media>
				<Empty.Title>No instances yet</Empty.Title>
				<Empty.Description>Create your first server to get started.</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button onclick={() => (createOpen = true)}><PlusIcon />New instance</Button>
			</Empty.Content>
		</Empty.Root>
	{/if}

	<div class="grid gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3">
		{#each instances ?? [] as inst (inst.id)}
			{@const installing = inst.installState === 'installing'}
			{@const failed = inst.installState === 'failed'}
			{@const active = inst.state === 'running' || inst.state === 'stopping'}
			{@const progress = inst.progress}
			<Card.Root>
				<Card.Header>
					<Card.Title>{inst.name}</Card.Title>
					<Card.Description>
						{inst.loader}
						{inst.mcVersion} · port {inst.port} · {inst.ramMaxMb} MB
					</Card.Description>
					<Card.Action>
						<StatusPill state={installing ? 'installing' : failed ? 'failed' : inst.state} />
					</Card.Action>
				</Card.Header>
				{#if installing}
					<Card.Content class="grid gap-2">
						<Progress
							value={progress ? progress.done : 0}
							max={Math.max(progress?.total ?? 1, 1)}
						/>
						<p class="text-xs text-muted-foreground">
							{progress?.label ?? 'Starting'}{progress && progress.total > 1
								? ` · ${progress.done}/${progress.total}`
								: ''}
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
							You can leave this page; the install keeps going.
						</p>
					{:else if failed}
						<Button variant="destructive" size="sm" onclick={() => askDelete(inst)}>Delete</Button>
					{:else}
						<Button variant="secondary" size="sm" href="/instances/{inst.id}">Console</Button>
						{#if active}
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
							<Button variant="ghost" size="sm" onclick={() => askDelete(inst)}>Delete</Button>
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
