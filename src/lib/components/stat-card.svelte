<script lang="ts">
	import type { Snippet } from 'svelte';

	import * as Card from '#lib/components/ui/card/index.js';

	/** One figure with a title, a line under it, and room for a trend or a bar. */
	let {
		title,
		value,
		hint,
		children
	}: { title: string; value: string; hint?: string; children?: Snippet } = $props();
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Description>{title}</Card.Description>
		<Card.Title class="text-2xl font-semibold tabular-nums">{value}</Card.Title>
	</Card.Header>
	{#if children}
		<Card.Content>{@render children()}</Card.Content>
	{/if}
	{#if hint}
		<Card.Footer class="text-xs text-muted-foreground">{hint}</Card.Footer>
	{/if}
</Card.Root>
