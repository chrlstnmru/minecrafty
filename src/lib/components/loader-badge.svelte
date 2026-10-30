<script lang="ts">
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';

	/** A loader's name in its own color, with its icon. */
	let { loader, version }: { loader: string; version?: string | null } = $props();
</script>

<Badge variant="muted" data-loader={loader} class="gap-1 loader-badge pl-1 capitalize">
	<InstanceIcon {loader} class="size-3.5 bg-transparent p-0" />
	{loader}{#if version}<span class="font-normal normal-case opacity-70">{version}</span>{/if}
</Badge>
