<script lang="ts">
	import { page } from '$app/state';

	import { instanceBackups } from '#lib/backups.remote.js';
	import SkeletonCard from '#lib/components/skeleton-card.svelte';
	import { rendered } from '#lib/rendered.js';

	import BackupsView from './backups-view.svelte';

	const id = $derived(page.params.id!);
	const loaded = $derived(await rendered(instanceBackups(id)));
</script>

{#if loaded}
	<BackupsView />
{:else}
	<div class="grid max-w-3xl gap-4">
		<SkeletonCard title="Saved backups" />
		<SkeletonCard title="Retention and exclusions" rows={2} />
	</div>
{/if}
