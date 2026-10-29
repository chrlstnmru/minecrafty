<script lang="ts">
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';

	// placeholder for a list of "icon, title, description" rows while the first load is in flight
	let { count = 4, icon = 'size-10' }: { count?: number; icon?: string } = $props();
</script>

<div class="grid gap-1" role="status" aria-label="Loading">
	{#each Array.from({ length: count }, (_, i) => i) as i (i)}
		<div class="flex items-center gap-3 p-2">
			<Skeleton class="{icon} shrink-0" />
			<div class="grid min-w-0 flex-1 gap-2">
				<Skeleton class="h-3.5 w-1/3" />
				<Skeleton class="h-3 w-3/4" />
			</div>
		</div>
	{/each}
</div>
