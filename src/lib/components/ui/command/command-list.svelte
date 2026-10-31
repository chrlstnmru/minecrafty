<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';

	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CommandPrimitive.ListProps = $props();
</script>

<CommandPrimitive.List
	bind:ref
	data-slot="command-list"
	class={cn(
		'max-h-72 scroll-py-1 [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_55%,transparent)_transparent] overflow-x-hidden overflow-y-auto outline-none',
		className
	)}
	{...restProps}
/>
