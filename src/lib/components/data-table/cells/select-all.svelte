<script lang="ts">
	import type { RowData, Table } from '@tanstack/svelte-table';

	import { Checkbox } from '#lib/components/ui/checkbox/index.js';

	import type { Features } from '../hook.js';

	type SelectableTable = Pick<
		Table<Features, RowData>,
		'getIsAllPageRowsSelected' | 'getIsSomePageRowsSelected' | 'toggleAllPageRowsSelected'
	>;

	let { table }: { table: SelectableTable } = $props();

	const all = $derived(table.getIsAllPageRowsSelected());
</script>

<Checkbox
	aria-label="Select all rows on this page"
	bind:checked={() => all, (checked) => table.toggleAllPageRowsSelected(checked)}
	indeterminate={!all && table.getIsSomePageRowsSelected()}
/>
