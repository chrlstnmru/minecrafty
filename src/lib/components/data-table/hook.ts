import type { Component } from 'svelte';
import {
	columnFacetingFeature,
	columnFilteringFeature,
	columnVisibilityFeature,
	constructFilterFn,
	createFacetedRowModel,
	createFacetedUniqueValues,
	createFilteredRowModel,
	createPaginatedRowModel,
	createSortedRowModel,
	createTableHook,
	filterFn_includesString,
	globalFilteringFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_basic,
	sortFn_datetime,
	sortFn_text,
	tableFeatures
} from '@tanstack/svelte-table';

export type FilterOption = {
	value: string;
	label: string;
	icon?: Component;
};

export type DataTableColumnMeta = {
	/** Name used by the view menu, filter button and stacked rows. Defaults to a string `header`. */
	label?: string;
	align?: 'start' | 'end';
	/** Classes applied to the column's header and body cells. */
	class?: string;
	/** Choices for `<DataTable.Filter>`. Without them the filter lists the column's unique values. */
	options?: FilterOption[];
	/**
	 * Where the cell goes when the table collapses to stacked rows on narrow containers.
	 * `title` and `subtitle` stack on the left, `end` sits on the right.
	 * Columns without `stack` are left out of stacked rows.
	 */
	stack?: 'title' | 'subtitle' | 'end';
};

/** Keeps rows whose value (or any of its values, for array columns) is in the selected set. */
const oneOf = constructFilterFn({
	filter: (dataValue: unknown, filterValue: string[]) =>
		Array.isArray(dataValue)
			? dataValue.some((v) => filterValue.includes(v))
			: filterValue.includes(dataValue as string),
	autoRemove: (filterValue: unknown) => !Array.isArray(filterValue) || filterValue.length === 0
});

export const features = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	filteredRowModel: createFilteredRowModel(),
	filterFns: { includesString: filterFn_includesString, oneOf },
	columnFacetingFeature,
	facetedRowModel: createFacetedRowModel(),
	facetedUniqueValues: createFacetedUniqueValues(),
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		basic: sortFn_basic,
		datetime: sortFn_datetime,
		text: sortFn_text
	},
	rowPaginationFeature,
	paginatedRowModel: createPaginatedRowModel(),
	rowSelectionFeature,
	columnVisibilityFeature,
	columnMeta: {} as DataTableColumnMeta
});

export type Features = typeof features;

export const {
	createAppTable,
	createAppColumnHelper,
	useTableContext,
	useCellContext,
	useHeaderContext
} = createTableHook({
	features,
	globalFilterFn: 'includesString',
	// Filters, search and the page live in the URL, so the page index is reset by the controls
	// that change them rather than whenever data reloads.
	autoResetPageIndex: false,
	isRowRangeSelectionEvent: (event) => (event as { shiftKey?: boolean }).shiftKey === true
});
