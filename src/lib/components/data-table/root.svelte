<script lang="ts" generics="TData extends RowData">
	import type { RowData } from '@tanstack/svelte-table';
	import type { Snippet } from 'svelte';
	import { cn } from '#lib/utils.js';
	import type { DataTable } from './create-data-table.svelte.js';

	let {
		table,
		class: className,
		children
	}: { table: DataTable<TData>; class?: string; children: Snippet } = $props();
</script>

<!-- The container query lets the table collapse to stacked rows by its own width, not the viewport's. -->
<table.AppTable>
	<div class={cn('@container/data-table flex min-w-0 flex-col gap-3', className)}>
		{@render children()}
	</div>
</table.AppTable>
