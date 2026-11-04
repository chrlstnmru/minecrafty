<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';

	// placeholder for a settings card while its first load is in flight; the title is known already
	let { title, rows = 3 }: { title: string; rows?: number } = $props();
</script>

<Card.Root role="status" aria-label="Loading {title}">
	<Card.Header>
		<Card.Title>{title}</Card.Title>
		<Skeleton class="h-4 w-2/3" />
	</Card.Header>
	<Card.Content class="grid gap-3">
		{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
			<Skeleton class="h-9 w-full" />
		{/each}
	</Card.Content>
</Card.Root>
