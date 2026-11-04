<script lang="ts">
	import { page } from '$app/state';

	import SkeletonCard from '#lib/components/skeleton-card.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { playerLists } from '#lib/players.remote.js';
	import { rendered } from '#lib/rendered.js';

	import PlayersView from './players-view.svelte';

	const id = $derived(page.params.id!);
	const loaded = $derived(await rendered(playerLists(id)));
</script>

{#if loaded}
	<PlayersView />
{:else}
	<div class="grid max-w-3xl gap-2">
		<Skeleton class="h-9 w-80 max-w-full" />
		<SkeletonCard title="Online now" rows={2} />
	</div>
{/if}
