import type { CellContext, DisplayColumnDef, RowData } from '@tanstack/svelte-table';
import { renderComponent } from '@tanstack/svelte-table';
import type { Features } from './hook.js';
import DateCell from './cells/date-cell.svelte';
import SelectAll from './cells/select-all.svelte';
import SelectRow from './cells/select-row.svelte';

/**
 * A checkbox column for row selection. Shift+click selects a range.
 * `label` names each row for screen readers ("Select Ana Cruz").
 */
export function selectColumn<TData extends RowData>(
	label: (row: TData) => string = () => 'Select row'
): DisplayColumnDef<Features, TData> {
	return {
		id: 'select',
		header: ({ table }) => renderComponent(SelectAll, { table }),
		cell: ({ row }) => renderComponent(SelectRow, { row, label: `Select ${label(row.original)}` }),
		enableSorting: false,
		enableHiding: false,
		meta: { class: 'w-10' }
	};
}

/** Cell renderer for date values: "Oct 14, 2026", or "3 days ago" with `relative`. */
export function dateCell(options: { relative?: boolean; fallback?: string } = {}) {
	return ({ getValue }: Pick<CellContext<Features, RowData, unknown>, 'getValue'>) =>
		renderComponent(DateCell, { value: getValue() as Date | string | null, ...options });
}
