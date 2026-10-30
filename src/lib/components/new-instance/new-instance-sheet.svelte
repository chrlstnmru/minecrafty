<script lang="ts">
	import { nextPort, createInstance } from '#lib/instances.remote.js';
	import { importModpack } from '#lib/modpacks.remote.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import LocalPackForm from './local-pack-form.svelte';
	import ModpackForm from './modpack-form.svelte';
	import ScratchForm from './scratch-form.svelte';

	let {
		open = $bindable(false),
		canUsePacks = false
	}: {
		open?: boolean;
		/** the user may see the Modpack builder's packs, so "From local" is offered */
		canUsePacks?: boolean;
	} = $props();

	// The sheet itself never scrolls: header and tabs stay put and each tab scrolls its own content.
	let tab = $state('scratch');

	// leaving mid-request would hide the progress and any error
	const busy = $derived(createInstance.pending > 0 || importModpack.pending > 0);

	// start each time with sensible defaults and the next free port
	$effect(() => {
		if (!open) return;
		let cancelled = false;
		nextPort().then((port) => {
			if (cancelled) return;
			createInstance.fields.set({ loader: 'vanilla', ramMaxMb: 2048, port });
			importModpack.fields.set({ ramMaxMb: 4096, port });
		});
		return () => (cancelled = true);
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		class="overflow-hidden"
		showCloseButton={!busy}
		onEscapeKeydown={(e) => busy && e.preventDefault()}
		onInteractOutside={(e) => busy && e.preventDefault()}
	>
		<Sheet.Header>
			<Sheet.Title>New instance</Sheet.Title>
			<Sheet.Description>
				Server files come from the loader's or modpack's official source.
			</Sheet.Description>
		</Sheet.Header>
		<Tabs.Root bind:value={tab} class="min-h-0 flex-1 px-4 pb-4">
			<Tabs.List class="w-full">
				<Tabs.Trigger value="scratch">From scratch</Tabs.Trigger>
				<Tabs.Trigger value="modpack">From modpack</Tabs.Trigger>
				{#if canUsePacks}<Tabs.Trigger value="local">From local</Tabs.Trigger>{/if}
			</Tabs.List>
			<Tabs.Content
				value="scratch"
				class="flex min-h-0 flex-1 flex-col pt-4 data-[state=inactive]:hidden"
			>
				<ScratchForm onDone={() => (open = false)} />
			</Tabs.Content>
			<Tabs.Content
				value="modpack"
				class="flex min-h-0 flex-1 flex-col pt-4 data-[state=inactive]:hidden"
			>
				<ModpackForm onDone={() => (open = false)} />
			</Tabs.Content>
			{#if canUsePacks}
				<Tabs.Content
					value="local"
					class="flex min-h-0 flex-1 flex-col pt-4 data-[state=inactive]:hidden"
				>
					<LocalPackForm onDone={() => (open = false)} />
				</Tabs.Content>
			{/if}
		</Tabs.Root>
	</Sheet.Content>
</Sheet.Root>
