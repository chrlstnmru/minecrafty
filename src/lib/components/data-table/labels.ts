import type { Column, RowData } from '@tanstack/svelte-table';

import type { Features } from './hook.js';

/** The name people see for a column: `meta.label`, else a string `header`, else its id. */
export function columnLabel<TData extends RowData>(column: Column<Features, TData, unknown>) {
	const { meta, header } = column.columnDef;
	return meta?.label ?? (typeof header === 'string' ? header : column.id);
}
