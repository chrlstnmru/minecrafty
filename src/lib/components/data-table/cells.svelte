<script lang="ts" generics="TData extends RowData">
	import type { Row, RowData } from '@tanstack/svelte-table';
	import { FlexRender } from '@tanstack/svelte-table';
	import * as Table from '#lib/components/ui/table/index.js';
	import type { Features } from './hook.js';

	let { row }: { row: Row<Features, TData> } = $props();
</script>

{#each row.getVisibleCells() as cell (cell.id)}
	{@const meta = cell.column.columnDef.meta}
	<Table.Cell
		data-column-id={cell.column.id}
		class={[meta?.align === 'end' && 'text-right', meta?.class]}
	>
		<FlexRender {cell} />
	</Table.Cell>
{/each}
