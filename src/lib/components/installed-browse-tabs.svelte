<script lang="ts">
	import type { View } from '#lib/installed-browse.svelte.js';

	import CountBadge from '#lib/components/count-badge.svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.js';

	/** The Installed and Browse tabs over a list; `view` comes from `viewParam`. */
	let {
		view,
		count,
		canBrowse = true
	}: { view: { current: View }; count: number; canBrowse?: boolean } = $props();
</script>

<Tabs.Root value={view.current} onValueChange={(value) => (view.current = value as View)}>
	<Tabs.List>
		<Tabs.Trigger value="installed">Installed <CountBadge {count} /></Tabs.Trigger>
		{#if canBrowse}<Tabs.Trigger value="browse">Browse</Tabs.Trigger>{/if}
	</Tabs.List>
</Tabs.Root>
