<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		level = 1,
		badge,
		actions
	}: {
		title: string;
		description?: string;
		/** 1 for a page title; 2 for a section under a page that already has one */
		level?: 1 | 2;
		badge?: Snippet;
		actions?: Snippet;
	} = $props();

	const tag = $derived(`h${level}`);
</script>

<header class="flex flex-wrap items-center gap-x-4 gap-y-2">
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<div class="flex min-w-0 items-center gap-2">
			<svelte:element
				this={tag}
				class="truncate font-heading font-semibold {level === 1 ? 'text-2xl' : 'text-lg'}"
			>
				{title}
			</svelte:element>
			{@render badge?.()}
		</div>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{@render actions?.()}
</header>
