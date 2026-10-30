<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		badge,
		actions
	}: {
		title: string;
		description?: string;
		badge?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<header class="flex flex-wrap items-center gap-x-4 gap-y-2">
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<div class="flex min-w-0 items-center gap-2">
			<h1 class="truncate font-heading text-2xl font-semibold">{title}</h1>
			{@render badge?.()}
		</div>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{@render actions?.()}
</header>
