<script lang="ts" generics="TData extends RowData">
	import type { Row, RowData } from '@tanstack/svelte-table';
	import type { Snippet } from 'svelte';

	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';

	import { Button } from '#lib/components/ui/button/index.js';

	import type { DataTable } from './create-data-table.svelte.js';
	import type { Features } from './hook.js';

	import { useTableContext } from './hook.js';

	let {
		table: tableProp,
		children
	}: {
		/** Optional: pass the table so the selected rows have your row type. */
		table?: DataTable<TData>;
		/**
		 * Bulk actions. `ids` covers every selected row, including ones on other pages; `rows` only
		 * has the loaded ones (all of them for client-side tables).
		 */
		children: Snippet<[{ ids: string[]; rows: Row<Features, TData>[] }]>;
	} = $props();

	// The table instance never changes, so reading the prop once is fine.
	// svelte-ignore state_referenced_locally
	const table = tableProp ?? useTableContext<TData>();
	const ids = $derived(
		Object.entries(table.atoms.rowSelection.get())
			.filter(([, selected]) => selected)
			.map(([id]) => id)
	);
	const rows = $derived(table.getSelectedRowModel().rows);
</script>

{#if ids.length}
	<!-- Floats like the save bar, so bulk actions stay in reach on long pages. -->
	<div
		class="pointer-events-none fixed inset-x-4 bottom-6 z-40 flex justify-center"
		transition:fly={{ y: 16, duration: prefersReducedMotion.current ? 0 : 160 }}
	>
		<div
			role="toolbar"
			aria-label="Bulk actions"
			class="pointer-events-auto flex w-full max-w-lg flex-wrap items-center gap-3 rounded-xl border bg-popover py-2.5 ps-4 pe-2.5 text-popover-foreground shadow-lg"
		>
			<p class="min-w-0 flex-1 text-xs/relaxed" aria-live="polite">
				<span class="font-semibold">{ids.length}</span> selected
			</p>
			<div class="flex gap-1.5">
				<Button variant="ghost" size="sm" onclick={() => table.resetRowSelection(true)}>
					Clear
				</Button>
				{@render children({ ids, rows })}
			</div>
		</div>
	</div>
{/if}
