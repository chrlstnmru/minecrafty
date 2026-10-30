<script lang="ts">
	import { panelAudit } from '#lib/audit.remote.js';
	import AuditTable from '#lib/components/audit-table.svelte';
	import PageHeader from '#lib/components/page-header.svelte';

	const log = panelAudit();
</script>

<svelte:head><title>Audit log · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader
		title="Audit log"
		description="Who did what across the panel. The newest 1,000 entries are shown; older ones are kept for 180 days."
	/>
	<AuditTable rows={log.current} showServer loading={!log.current} />
</div>
