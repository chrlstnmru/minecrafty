<script lang="ts">
	import type { Row, RowData } from '@tanstack/svelte-table';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import type { Features } from '../hook.js';

	type SelectableRow = Pick<
		Row<Features, RowData>,
		'getIsSelected' | 'getCanSelect' | 'getToggleSelectedHandler'
	>;

	let { row, label }: { row: SelectableRow; label: string } = $props();

	const selected = $derived(row.getIsSelected());

	// The table's handler reads `target.checked` and, for Shift+click ranges, `shiftKey`.
	// bits-ui's checkbox is a button, so hand it both directly.
	function onclick(event: MouseEvent) {
		row.getToggleSelectedHandler()({ target: { checked: !selected }, shiftKey: event.shiftKey });
	}
</script>

<Checkbox
	aria-label={label}
	disabled={!row.getCanSelect()}
	bind:checked={() => selected, () => {}}
	{onclick}
/>
