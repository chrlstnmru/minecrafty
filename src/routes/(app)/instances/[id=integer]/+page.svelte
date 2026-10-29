<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import { toast } from 'svelte-sonner';
	import { getInstance, killInstance, startInstance, stopInstance } from '#lib/instances.remote.js';
	import ConsoleView from '#lib/components/console-view.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const instance = $derived(getInstance(id));

	let status = $state('stopped');
	const active = $derived(status === 'running' || status === 'stopping');

	async function run(action: (id: number) => Promise<void>) {
		try {
			await action(id);
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Action failed');
		}
	}
</script>

<svelte:head><title>{instance.current?.name ?? 'Console'} · Minecrafty</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
	<div class="flex flex-wrap items-center gap-3">
		<Button variant="ghost" size="icon" href="/instances" aria-label="Back to instances">
			<ArrowLeftIcon />
		</Button>
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-lg font-medium">{instance.current?.name ?? ''}</h2>
			{#if instance.current}
				<p class="text-sm text-muted-foreground">
					{instance.current.loader}
					{instance.current.mcVersion} · port {instance.current.port}
				</p>
			{/if}
		</div>
		<Badge
			variant={status === 'running' ? 'default' : status === 'stopping' ? 'secondary' : 'outline'}
		>
			{status}
		</Badge>
		{#if active}
			<Button
				variant="outline"
				size="sm"
				disabled={status === 'stopping'}
				onClickPromise={() => run(stopInstance)}
			>
				Stop
			</Button>
			<Button variant="destructive" size="sm" onClickPromise={() => run(killInstance)}>Kill</Button>
		{:else}
			<Button size="sm" onClickPromise={() => run(startInstance)}>Start</Button>
		{/if}
	</div>

	<ConsoleView {id} bind:status />
</div>
