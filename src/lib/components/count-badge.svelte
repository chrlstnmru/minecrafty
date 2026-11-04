<!-- How many there are, next to a tab or nav label; nothing at 0, where the empty view already says so. -->
<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';

	let { count }: { count: number } = $props();
</script>

{#if count > 0}
	<Badge variant="muted" class="tabular-nums">{count}</Badge>
{/if}
