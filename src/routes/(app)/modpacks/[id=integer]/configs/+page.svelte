<script lang="ts">
	import { page } from '$app/state';

	import PackConfigs from '#lib/components/pack-configs.svelte';
	import { getLocalPack } from '#lib/modpacks/builder.remote.js';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const pack = $derived(await getLocalPack({ id }));
</script>

<PackConfigs
	{id}
	files={pack.overrides}
	canWrite={data.panel.includes('modpacks.write')}
	class="min-h-0 flex-1"
/>
