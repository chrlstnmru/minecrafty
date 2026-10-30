<script lang="ts">
	import { sparkArea, sparkPoints } from '#lib/spark.js';
	import { cn } from '#lib/utils.js';

	/** A trend line, drawn in the text color of its parent. */
	let {
		values,
		max = 100,
		class: className
	}: { values: (number | null)[]; max?: number; class?: string } = $props();

	const WIDTH = 100;
	const HEIGHT = 24;
	const line = $derived(sparkPoints(values, max, WIDTH, HEIGHT));
	const area = $derived(sparkArea(values, max, WIDTH, HEIGHT));
</script>

<svg
	viewBox="0 0 {WIDTH} {HEIGHT}"
	preserveAspectRatio="none"
	class={cn('h-8 w-full', className)}
	role="img"
	aria-label="Trend over the last few minutes"
>
	{#if line}
		<polygon points={area} fill="currentColor" fill-opacity="0.12" />
		<polyline
			points={line}
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		/>
	{/if}
</svg>
