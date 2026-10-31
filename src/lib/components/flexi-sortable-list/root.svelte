<script lang="ts">
	import type { FlexiBoardConfiguration } from '@flexiboards/svelte';
	import type { ComponentProps } from 'svelte';

	import { FlexiSortable } from '@flexiboards/svelte';

	import { cn } from '#lib/utils.js';

	import { reducedMotion, withMotion } from '../flexi-motion/index.js';
	let {
		class: className,
		config,
		key = 'list',
		direction = 'vertical',
		anchored = true,
		onreorder,
		controller = $bindable(),
		...props
	}: ComponentProps<typeof FlexiSortable> & {
		/** Keep a dragged row on the list's axis and inside its bounds. */
		anchored?: boolean;
		onreorder?: (ids: string[]) => void;
	} = $props();
	const boardConfig = $derived<FlexiBoardConfiguration>({
		...withMotion(config, reducedMotion.current),
		onLayoutChange: (layout) => {
			config?.onLayoutChange?.(layout);
			onreorder?.(
				(layout[key] ?? [])
					.toSorted((a, b) =>
						direction === 'vertical' ? (a.y ?? 0) - (b.y ?? 0) : (a.x ?? 0) - (b.x ?? 0)
					)
					.flatMap((entry) => (typeof entry.metadata?.id === 'string' ? [entry.metadata.id] : []))
			);
		}
	});

	let list = $state<HTMLElement>();

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	// Flexiboards has no axis lock: the held row follows the raw pointer, and so does its drop
	// detection. So while a handle is held, real pointer moves are swallowed at the window and
	// replayed with the pointer pinned to the grab's cross-axis position and clamped so the row
	// stays inside the list. The row, the drop preview and the drop all agree with what's shown.
	function anchor(down: PointerEvent) {
		const target = down.target as Element | null;
		const row = target?.closest('[data-flexi-widget]');
		if (!anchored || !list || !row || !target?.closest('.flexi-grabber')) return;

		const rowRect = row.getBoundingClientRect();
		const offsetX = down.clientX - rowRect.left;
		const offsetY = down.clientY - rowRect.top;

		function move(event: PointerEvent) {
			if (!event.isTrusted || event.pointerId !== down.pointerId || !list) return;
			event.stopImmediatePropagation();
			const bounds = list.getBoundingClientRect();
			const vertical = direction === 'vertical';
			const clientX = vertical
				? down.clientX
				: clamp(event.clientX, bounds.left + offsetX, bounds.right - rowRect.width + offsetX);
			const clientY = vertical
				? clamp(event.clientY, bounds.top + offsetY, bounds.bottom - rowRect.height + offsetY)
				: down.clientY;
			// Dispatched on document so it reaches Flexiboards' document and window listeners.
			document.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					pointerId: event.pointerId,
					pointerType: event.pointerType,
					isPrimary: event.isPrimary,
					buttons: event.buttons,
					clientX,
					clientY
				})
			);
		}

		function release(event: PointerEvent) {
			if (event.pointerId !== down.pointerId) return;
			window.removeEventListener('pointermove', move, true);
			window.removeEventListener('pointerup', release, true);
			window.removeEventListener('pointercancel', release, true);
		}

		window.addEventListener('pointermove', move, true);
		window.addEventListener('pointerup', release, true);
		window.addEventListener('pointercancel', release, true);
	}
</script>

<div bind:this={list} onpointerdowncapture={anchor}>
	<FlexiSortable
		{...props}
		bind:controller
		{key}
		{direction}
		class={cn('gap-2', className)}
		config={boardConfig}
	/>
</div>
