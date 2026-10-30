<script lang="ts">
	import { page } from '$app/state';
	import { instanceAudit } from '#lib/audit.remote.js';
	import AuditTable from '#lib/components/audit-table.svelte';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const log = $derived(instanceAudit(id));
</script>

<AuditTable rows={log.current} loading={!log.current} />
