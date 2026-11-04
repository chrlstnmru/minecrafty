<script lang="ts">
	import type { Snippet } from 'svelte';

	import * as Card from '#lib/components/ui/card/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';

	/**
	 * One figure with a title, a line under it, and room for a trend or a bar. While `loading`, each
	 * part is laid out as usual but hidden under a skeleton, so the card keeps its size when the
	 * numbers arrive.
	 */
	let {
		title,
		value,
		hint,
		loading = false,
		children
	}: {
		title: string;
		value: string;
		hint?: string;
		loading?: boolean;
		children?: Snippet;
	} = $props();
</script>

<Card.Root size="sm" aria-busy={loading}>
	<Card.Header>
		<Card.Description>{title}</Card.Description>
		<Card.Title class="relative text-2xl font-semibold tabular-nums">
			{#if loading}
				<span class="invisible" aria-hidden="true">0</span>
				<Skeleton class="absolute inset-y-0.5 start-0 w-2/5" />
			{:else}
				{value}
			{/if}
		</Card.Title>
	</Card.Header>
	{#if children}
		<Card.Content class="relative">
			<div class={loading ? 'invisible' : undefined} aria-hidden={loading}>
				{@render children()}
			</div>
			{#if loading}<Skeleton class="absolute inset-0 mx-(--card-spacing)" />{/if}
		</Card.Content>
	{/if}
	{#if loading || hint}
		<Card.Footer class="text-xs text-muted-foreground">
			<span class="relative block w-full">
				{#if loading}
					<span class="invisible" aria-hidden="true">&nbsp;</span>
					<Skeleton class="absolute inset-y-0.5 start-0 w-3/5" />
				{:else}
					{hint}
				{/if}
			</span>
		</Card.Footer>
	{/if}
</Card.Root>
