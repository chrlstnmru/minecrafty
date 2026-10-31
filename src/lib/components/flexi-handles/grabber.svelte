<script lang="ts">
	import type { FlexiWidgetClasses } from '@flexiboards/svelte';
	import type { ComponentProps } from 'svelte';

	import { getFlexiwidgetCtx, FlexiGrab } from '@flexiboards/svelte';
	import GripVertical from '@tabler/icons-svelte/icons/grip-vertical';

	import { cn } from '#lib/utils.js';
	let {
		class: className,
		children: content,
		size = 16,
		label = 'Move widget'
	}: Omit<ComponentProps<typeof FlexiGrab>, 'class'> & {
		class?: FlexiWidgetClasses;
		size?: number;
		label?: string;
	} = $props();
	const widget = getFlexiwidgetCtx();
</script>

<FlexiGrab
	class={cn(
		// `flexi-grabber` marks the handle for SortableList.Root's anchored drag.
		'inline-flex size-8 shrink-0 flexi-grabber items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40',
		typeof className === 'function' ? className(widget) : className
	)}
>
	{#snippet children(context)}
		<span class="sr-only">{label}</span>
		{#if content}{@render content(context)}{:else}<GripVertical {size} aria-hidden="true" />{/if}
	{/snippet}
</FlexiGrab>
