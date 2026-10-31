<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import { cn, type WithElementRef } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-content"
	class={cn(
		'flex w-full max-w-sm min-w-0 flex-col items-center gap-2 text-xs/relaxed text-balance',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
