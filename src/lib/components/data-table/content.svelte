<script lang="ts" generics="TData extends RowData">
	import type { Row, RowData } from '@tanstack/svelte-table';
	import type { Snippet } from 'svelte';
	import { FlexRender } from '@tanstack/svelte-table';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { cn } from '#lib/utils.js';
	import type { DataTable } from './create-data-table.svelte.js';
	import type { Features } from './hook.js';
	import { useTableContext } from './hook.js';
	import LayoutProvider from './layout-provider.svelte';
	import DataTableRow from './row.svelte';
	import SortHeader from './sort-header.svelte';

	let {
		row: rowSnippet,
		stacked,
		empty,
		loading = false,
		table: tableProp,
		class: className
	}: {
		/** Optional: pass the table so `row.original` in snippets has your row type. */
		table?: DataTable<TData>;
		/**
		 * Renders each row, in both the table and the stacked layout. Use `<DataTable.Row>` inside,
		 * which adapts to the layout. Defaults to `<DataTable.Row {row} />`.
		 */
		row?: Snippet<[Row<Features, TData>]>;
		/** Renders each row in the stacked layout only, instead of `row`. */
		stacked?: Snippet<[Row<Features, TData>]>;
		/** Shown when there are no rows at all. A search or filter with no matches has its own message. */
		empty?: Snippet;
		/** Show placeholder rows instead of the empty state while data loads. */
		loading?: boolean;
		class?: string;
	} = $props();

	// The table instance never changes, so reading the prop once is fine.
	// svelte-ignore state_referenced_locally
	const table = tableProp ?? useTableContext<TData>();
	const rows = $derived(table.getRowModel().rows);
	const columnCount = $derived(table.getVisibleLeafColumns().length);
	const filtered = $derived(
		!!table.atoms.globalFilter.get() || table.atoms.columnFilters.get().length > 0
	);

	// A page number from the URL, or rows removed from the last page, can leave the index past the end.
	$effect(() => {
		const pageCount = table.getPageCount();
		if (pageCount > 0 && table.atoms.pagination.get().pageIndex >= pageCount) {
			table.setPageIndex(pageCount - 1);
		}
	});

	function clearFilters() {
		table.setGlobalFilter('');
		table.resetColumnFilters(true);
		table.setPageIndex(0);
	}
</script>

{#snippet emptyState()}
	{#if filtered}
		<Empty.Root class="p-8">
			<Empty.Header>
				<Empty.Title>No matches</Empty.Title>
				<Empty.Description>Try another search, or clear the filters.</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
			</Empty.Content>
		</Empty.Root>
	{:else if empty}
		{@render empty()}
	{:else}
		<Empty.Root class="p-8">
			<Empty.Header>
				<Empty.Title>Nothing here yet</Empty.Title>
			</Empty.Header>
		</Empty.Root>
	{/if}
{/snippet}

<div class={cn('overflow-hidden rounded-xl border bg-card', className)}>
	<div class="hidden @2xl/data-table:block">
		<LayoutProvider layout="table">
			<Table.Root>
				<Table.Header>
					{#each table.getHeaderGroups() as group (group.id)}
						<Table.Row class="hover:bg-transparent">
							{#each group.headers as header (header.id)}
								{@const meta = header.column.columnDef.meta}
								{@const sorted = header.column.getIsSorted()}
								<Table.Head
									colspan={header.colSpan}
									aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
									class={[meta?.align === 'end' && 'text-right', meta?.class]}
								>
									{#if header.isPlaceholder}
										<!-- Group header gap -->
									{:else if header.column.getCanSort()}
										<SortHeader {header} />
									{:else}
										<FlexRender {header} />
									{/if}
								</Table.Head>
							{/each}
						</Table.Row>
					{/each}
				</Table.Header>
				<Table.Body>
					{#if loading}
						{#each { length: 3 }, index (index)}
							<Table.Row class="hover:bg-transparent">
								<Table.Cell colspan={columnCount}><Skeleton class="h-5 w-full" /></Table.Cell>
							</Table.Row>
						{/each}
					{:else}
						{#each rows as row (row.id)}
							{#if rowSnippet}
								{@render rowSnippet(row)}
							{:else}
								<DataTableRow {row} />
							{/if}
						{:else}
							<Table.Row class="hover:bg-transparent">
								<Table.Cell colspan={columnCount} class="p-0 whitespace-normal">
									{@render emptyState()}
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</LayoutProvider>
	</div>

	<div class="divide-y @2xl/data-table:hidden">
		<LayoutProvider layout="stacked">
			{#if loading}
				{#each { length: 3 }, index (index)}
					<div class="px-4 py-3"><Skeleton class="h-9 w-full" /></div>
				{/each}
			{:else}
				{#each rows as row (row.id)}
					{#if stacked}
						{@render stacked(row)}
					{:else if rowSnippet}
						{@render rowSnippet(row)}
					{:else}
						<DataTableRow {row} />
					{/if}
				{:else}
					{@render emptyState()}
				{/each}
			{/if}
		</LayoutProvider>
	</div>
</div>
