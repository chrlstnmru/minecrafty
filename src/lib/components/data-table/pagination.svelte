<script lang="ts">
	import ChevronLeftIcon from '@tabler/icons-svelte/icons/chevron-left';
	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import ChevronsLeftIcon from '@tabler/icons-svelte/icons/chevrons-left';
	import ChevronsRightIcon from '@tabler/icons-svelte/icons/chevrons-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { cn } from '#lib/utils.js';
	import { PAGE_SIZES } from './create-data-table.svelte.js';
	import { useTableContext } from './hook.js';

	let {
		noun = ['row', 'rows'],
		class: className
	}: {
		/** Singular and plural name for a row, used in the count ("12 members"). */
		noun?: [string, string];
		class?: string;
	} = $props();

	const table = useTableContext();
	// Matching rows across all pages: the server's count for server-side tables.
	const total = $derived(table.getRowCount());
	const selected = $derived(Object.keys(table.atoms.rowSelection.get()).length);
	const pagination = $derived(table.atoms.pagination.get());
	const pageCount = $derived(Math.max(table.getPageCount(), 1));
</script>

<div
	class={cn(
		'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1 text-xs text-muted-foreground',
		className
	)}
>
	<p aria-live="polite">
		{#if selected}
			{selected} of {total} selected
		{:else}
			{total}
			{total === 1 ? noun[0] : noun[1]}
		{/if}
	</p>

	<div class="flex items-center gap-4">
		<div class="hidden items-center gap-2 @lg/data-table:flex">
			<span id="rows-per-page">Rows per page</span>
			<Select.Root
				type="single"
				bind:value={
					() => String(pagination.pageSize),
					(size) => {
						table.setPageSize(Number(size));
						table.setPageIndex(0);
					}
				}
			>
				<Select.Trigger size="sm" class="w-16" aria-labelledby="rows-per-page">
					{pagination.pageSize}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each PAGE_SIZES as size (size)}
							<Select.Item value={String(size)} label={String(size)} />
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</div>

		<span class="text-foreground">Page {pagination.pageIndex + 1} of {pageCount}</span>

		<div class="flex items-center gap-1">
			<Button
				variant="outline"
				size="icon-sm"
				class="hidden @lg/data-table:inline-flex"
				aria-label="First page"
				disabled={!table.getCanPreviousPage()}
				onclick={() => table.firstPage()}
			>
				<ChevronsLeftIcon />
			</Button>
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Previous page"
				disabled={!table.getCanPreviousPage()}
				onclick={() => table.previousPage()}
			>
				<ChevronLeftIcon />
			</Button>
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Next page"
				disabled={!table.getCanNextPage()}
				onclick={() => table.nextPage()}
			>
				<ChevronRightIcon />
			</Button>
			<Button
				variant="outline"
				size="icon-sm"
				class="hidden @lg/data-table:inline-flex"
				aria-label="Last page"
				disabled={!table.getCanNextPage()}
				onclick={() => table.lastPage()}
			>
				<ChevronsRightIcon />
			</Button>
		</div>
	</div>
</div>
