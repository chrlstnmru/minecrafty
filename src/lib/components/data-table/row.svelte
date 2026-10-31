<script lang="ts" generics="TData extends RowData">
	import type { Row, RowData } from '@tanstack/svelte-table';

	import * as Table from '#lib/components/ui/table/index.js';
	import { cn } from '#lib/utils.js';

	import type { Features } from './hook.js';

	import Cells from './cells.svelte';
	import { getLayout } from './layout.js';
	import StackedCells from './stacked-cells.svelte';

	let {
		row,
		class: className,
		onclick
	}: {
		row: Row<Features, TData>;
		class?: string;
		/**
		 * Runs when the row is clicked, except on its buttons, links and checkboxes, or anywhere in
		 * the `select` and `actions` columns. This is a pointer
		 * shortcut: also give the row a focusable control (like a name button) that does the same.
		 */
		onclick?: (event: MouseEvent) => void;
	} = $props();

	const layout = getLayout();

	function handleClick(event: MouseEvent) {
		const target = event.target as Element;
		if (target.closest('a, button, input, label, [role="checkbox"], [role="menuitem"]')) return;
		// A near miss on a checkbox or the actions menu shouldn't open the row instead.
		if (target.closest('[data-column-id="select"], [data-column-id="actions"]')) return;
		onclick?.(event);
	}
</script>

{#if layout === 'table'}
	<Table.Row
		data-state={row.getIsSelected() ? 'selected' : undefined}
		class={cn(onclick && 'cursor-pointer', className)}
		onclick={onclick && handleClick}
	>
		<Cells {row} />
	</Table.Row>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		data-state={row.getIsSelected() ? 'selected' : undefined}
		class={cn(
			'px-4 py-3 transition-colors data-[state=selected]:bg-muted',
			onclick && 'cursor-pointer hover:bg-muted/50',
			className
		)}
		onclick={onclick && handleClick}
	>
		<StackedCells {row} />
	</div>
{/if}
