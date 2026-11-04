<script lang="ts">
	import PageHeader from '#lib/components/page-header.svelte';
	import SkeletonRows from '#lib/components/skeleton-rows.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { rendered } from '#lib/rendered.js';
	import { getRoleAccess, listRoles } from '#lib/roles.remote.js';

	import RolesView from './roles-view.svelte';

	const [roles, access] = $derived(
		await Promise.all([rendered(listRoles()), rendered(getRoleAccess())])
	);
</script>

<svelte:head><title>Roles · Minecrafty</title></svelte:head>

{#if roles && access}
	<RolesView />
{:else}
	<div class="flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
		<PageHeader
			title="Roles"
			description="What each role grants and how roles rank. Give roles to people on the Users page."
		/>
		<div class="grid gap-6 md:grid-cols-[17rem_1fr]">
			<div class="rounded-xl border bg-card p-2"><SkeletonRows count={3} /></div>
			<Skeleton class="hidden h-64 rounded-xl md:block" />
		</div>
	</div>
{/if}
