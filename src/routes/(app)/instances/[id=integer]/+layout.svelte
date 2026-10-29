<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import { toast } from 'svelte-sonner';
	import { instanceModules } from '#lib/instance-modules.js';
	import {
		getInstance,
		killInstance,
		listInstances,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const instance = $derived(await getInstance(id));
	const all = listInstances();
	const status = $derived(all.current?.find((i) => i.id === id)?.state ?? 'stopped');
	const active = $derived(status === 'running' || status === 'stopping');
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
			<h2 class="truncate text-lg font-medium">{instance?.name ?? ''}</h2>
			{#if instance}
				<p class="text-sm text-muted-foreground">
					{instance.loader}
					{instance.mcVersion} · port {instance.port}
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

	{@render children()}
</div>
