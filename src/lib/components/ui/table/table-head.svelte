<script lang="ts">
	import type { HTMLThAttributes } from 'svelte/elements';
	import type { WithElementRef } from '#lib/utils.js';
	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLThAttributes> = $props();
</script>

<th
	bind:this={ref}
	data-slot="table-head"
	class={cn(
		'h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground first:ps-4 last:pe-4 [&:has([role=checkbox])]:pr-0',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</th>
