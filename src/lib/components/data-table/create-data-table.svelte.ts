import type { ColumnDef, RowData, TableOptions, TableState } from '@tanstack/svelte-table';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { untrack } from 'svelte';
import { currentUrl } from '#lib/navigation.js';
import type { Features } from './hook.js';
import { createAppTable } from './hook.js';

export const PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export type DataTable<TData extends RowData> = ReturnType<typeof createAppTable<TData>>;

export type DataTableOptions<TData extends RowData> = Omit<
	TableOptions<Features, TData>,
	'features'
> & {
	/**
	 * Keep search (`q`), column filters (one param per column id), sort (`sort=name,-joined`)
	 * and page (`page`, `size`) in the query string, so the view survives a refresh and can be
	 * shared. Other params, and `page.state` from shallow routing, are left alone.
	 */
	url?: boolean;
	/**
	 * Search, filter, sort and paginate on the server instead of in the browser. Pass `data` as
	 * the current page's rows and `rowCount` as the total matching rows, and build the request
	 * from `tableParams(table)`.
	 */
	server?: boolean;
};

/** What a server-side table asks the server for. Pages and sort ids are the table's own. */
export type TableParams = {
	/** Search text. */
	q: string;
	/** Selected values per filtered column id. */
	filters: Record<string, string[]>;
	sort: { id: string; desc: boolean }[];
	/** Zero-based. */
	page: number;
	size: number;
};

/** The table's current search, filters, sort and page, ready to send to a query. Reactive. */
export function tableParams<TData extends RowData>(table: DataTable<TData>): TableParams {
	const { pageIndex, pageSize } = table.atoms.pagination.get();
	return {
		q: ((table.atoms.globalFilter.get() as string | undefined) ?? '').trim(),
		filters: Object.fromEntries(
			table.atoms.columnFilters.get().map((f) => [f.id, f.value as string[]])
		),
		sort: table.atoms.sorting.get().map(({ id, desc }) => ({ id, desc })),
		page: pageIndex,
		size: pageSize
	};
}

/**
 * `createAppTable` with this app's defaults: page size 10, rows keyed by `getRowId`, and
 * optional URL state. Pass changing values (like `data`) as getters so the table follows them.
 */
export function createDataTable<TData extends RowData>(options: DataTableOptions<TData>) {
	const filterIds = columnIds(options.columns);
	const initialState: Partial<TableState<Features>> = {
		pagination: { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE },
		...options.initialState,
		...(options.url ? readUrl(currentUrl().searchParams, filterIds) : {})
	};

	// Copy descriptors rather than spreading, so getters like `get data()` stay live.
	const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(options);
	delete descriptors.url;
	delete descriptors.server;
	if (options.server) {
		for (const key of ['manualPagination', 'manualSorting', 'manualFiltering']) {
			descriptors[key] ??= { value: true, enumerable: true };
		}
	}
	descriptors.initialState = { value: initialState, enumerable: true };
	const tableOptions = Object.defineProperties({}, descriptors) as typeof options;

	const table = createAppTable<TData>(tableOptions);
	if (options.url) syncUrl(table, filterIds);
	return table;
}

function columnIds<TData extends RowData>(columns: ReadonlyArray<ColumnDef<Features, TData>>) {
	return columns
		.map((c) => c.id ?? ('accessorKey' in c ? String(c.accessorKey) : undefined))
		.filter((id): id is string => !!id);
}

function readUrl(
	params: Pick<URLSearchParams, 'get' | 'getAll'>,
	filterIds: string[]
): Partial<TableState<Features>> {
	const state: Partial<TableState<Features>> = {};

	const q = params.get('q');
	if (q) state.globalFilter = q;

	const columnFilters = filterIds
		.map((id) => ({ id, value: params.getAll(id) }))
		.filter((f) => f.value.length > 0);
	if (columnFilters.length) state.columnFilters = columnFilters;

	const sort = params.get('sort');
	if (sort) {
		state.sorting = sort
			.split(',')
			.filter(Boolean)
			.map((key) => ({ id: key.replace(/^-/, ''), desc: key.startsWith('-') }));
	}

	const size = Number(params.get('size'));
	const pageNumber = Number(params.get('page'));
	state.pagination = {
		pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
		pageIndex: Number.isInteger(pageNumber) && pageNumber > 1 ? pageNumber - 1 : 0
	};

	return state;
}

function syncUrl<TData extends RowData>(table: DataTable<TData>, filterIds: string[]) {
	$effect(() => {
		const q = table.atoms.globalFilter.get() as string | undefined;
		const filters = table.atoms.columnFilters.get();
		const sorting = table.atoms.sorting.get();
		const { pageIndex, pageSize } = table.atoms.pagination.get();

		untrack(() => {
			const current = currentUrl();
			const url = new URL(current.href);
			const params = url.searchParams;
			for (const key of ['q', 'sort', 'page', 'size', ...filterIds]) params.delete(key);

			if (q) params.set('q', q);
			for (const filter of filters) {
				for (const value of filter.value as string[]) params.append(filter.id, value);
			}
			if (sorting.length) {
				params.set('sort', sorting.map((s) => (s.desc ? '-' : '') + s.id).join(','));
			}
			if (pageIndex > 0) params.set('page', String(pageIndex + 1));
			if (pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(pageSize));

			if (url.search !== current.search) {
				// Shallow, so no load reruns and focus stays in the search box. Keeps `page.state`.
				void goto(url, { state: page.state, shallow: true, replace: true });
			}
		});
	});
}
