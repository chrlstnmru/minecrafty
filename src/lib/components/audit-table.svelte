<script lang="ts">
	import * as DataTable from '#lib/components/data-table/index.js';
	import { createColumns, createDataTable, dateCell } from '#lib/components/data-table/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';

	type Row = {
		id: number;
		at: Date;
		actorName: string;
		action: string;
		instanceId: number | null;
		instanceName: string | null;
		summary: string;
	};

	let {
		rows,
		showServer = false,
		loading = false
	}: {
		rows: Row[] | undefined;
		/** a Server column, for the panel's log; one server's log needs none */
		showServer?: boolean;
		loading?: boolean;
	} = $props();

	const col = createColumns<Row>();
	const columns = col.columns([
		col.accessor('at', {
			header: 'When',
			cell: dateCell({ time: true }),
			sortFn: 'datetime',
			meta: { stack: 'subtitle', class: 'w-48' }
		}),
		col.accessor('actorName', { header: 'Who', meta: { stack: 'subtitle' } }),
		col.accessor('summary', { header: 'What', meta: { stack: 'title' } }),
		// the action's name, for searching and sorting; hidden because the summary says it in words
		col.accessor('action', { header: 'Action', enableHiding: true }),
		col.accessor((r) => r.instanceName ?? '', {
			id: 'server',
			header: 'Server',
			meta: { stack: 'subtitle' }
		})
	]);

	// whether the Server column shows is decided once, by which page this is
	// svelte-ignore state_referenced_locally
	const table = createDataTable({
		columns,
		url: true,
		get data(): Row[] {
			return rows ?? [];
		},
		getRowId: (r) => String(r.id),
		initialState: {
			sorting: [{ id: 'at', desc: true }],
			columnVisibility: { action: false, server: showServer }
		}
	});
</script>

<DataTable.Root {table}>
	<DataTable.Toolbar>
		<DataTable.Search placeholder="Search the log" />
	</DataTable.Toolbar>
	<DataTable.Content {table} {loading}>
		{#snippet empty()}
			<Empty.Root class="p-8">
				<Empty.Header>
					<Empty.Title>Nothing recorded yet</Empty.Title>
					<Empty.Description>Actions show up here as people take them.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{/snippet}
	</DataTable.Content>
	<DataTable.Pagination noun={['entry', 'entries']} />
</DataTable.Root>
