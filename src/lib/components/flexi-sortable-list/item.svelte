<script lang="ts">
	import type { FlexiWidgetController } from '@flexiboards/svelte';
	import type { ComponentProps } from 'svelte';
	import { FlexiWidget } from '@flexiboards/svelte';
	import { cn } from '#lib/utils.js';
	let {
		class: className,
		controller = $bindable(),
		id,
		metadata,
		...props
	}: ComponentProps<typeof FlexiWidget> & { id: string } = $props();
</script>

<FlexiWidget
	{...props}
	{id}
	bind:controller
	metadata={{ ...metadata, id }}
	class={(widget: FlexiWidgetController) =>
		cn(
			'relative flex min-w-0 items-center gap-1 rounded-lg text-sm',
			widget.isShadow && 'border border-dashed opacity-60',
			widget.isGrabbed && 'bg-popover ring-2 ring-ring',
			typeof className === 'function' ? className(widget) : className
		)}
/>
