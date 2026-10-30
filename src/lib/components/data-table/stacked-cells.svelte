<script lang="ts" generics="TData extends RowData">
	import type { Row, RowData } from '@tanstack/svelte-table';
	import { FlexRender } from '@tanstack/svelte-table';
	import type { Features } from './hook.js';

	let { row }: { row: Row<Features, TData> } = $props();

	const cells = $derived(row.getVisibleCells());
	const select = $derived(cells.find((c) => c.column.id === 'select'));
	const placed = $derived(cells.filter((c) => c.column.columnDef.meta?.stack));
	// With no `stack` set anywhere, show the first data column so the row still says something.
	const title = $derived(
		placed.some((c) => c.column.columnDef.meta?.stack === 'title')
			? placed.filter((c) => c.column.columnDef.meta?.stack === 'title')
			: cells.filter((c) => c.column.accessorFn).slice(0, 1)
	);
	const subtitle = $derived(placed.filter((c) => c.column.columnDef.meta?.stack === 'subtitle'));
	const end = $derived(placed.filter((c) => c.column.columnDef.meta?.stack === 'end'));
</script>

<div class="flex items-center gap-3">
	{#if select}
		<div data-column-id="select" class="flex">
			<FlexRender cell={select} />
		</div>
	{/if}
	<div class="flex min-w-0 flex-1 flex-col gap-1.5">
		{#each title as cell (cell.id)}
			<div class="min-w-0">
				<FlexRender {cell} />
			</div>
		{/each}
		{#each subtitle as cell (cell.id)}
			<div class="min-w-0 text-xs text-muted-foreground">
				<FlexRender {cell} />
			</div>
		{/each}
	</div>
	{#each end as cell (cell.id)}
		<div data-column-id={cell.column.id} class="shrink-0">
			<FlexRender {cell} />
		</div>
	{/each}
</div>
