<script lang="ts">
	import { page } from '$app/state';

	import SkeletonCard from '#lib/components/skeleton-card.svelte';
	import { rendered } from '#lib/rendered.js';
	import { instanceSchedules } from '#lib/schedules.remote.js';

	import SchedulesView from './schedules-view.svelte';

	const id = $derived(page.params.id!);
	const loaded = $derived(await rendered(instanceSchedules(id)));
</script>

{#if loaded}
	<SchedulesView />
{:else}
	<div class="grid max-w-3xl gap-4">
		<SkeletonCard title="Scheduled tasks" />
	</div>
{/if}
