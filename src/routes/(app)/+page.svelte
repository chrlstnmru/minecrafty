<script lang="ts">
	import ChartAreaInteractive from '#lib/components/chart-area-interactive.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import DataTable from '#lib/components/data-table.svelte';
	import SectionCards from '#lib/components/section-cards.svelte';
	import data from './data.js';
</script>

<!-- Demo content from dashboard-01; replace with instance overview -->
<svelte:head><title>Dashboard · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
	<div class="px-4 lg:px-6">
		<PageHeader title="Dashboard" description="How your servers are doing at a glance." />
	</div>
	<SectionCards />
	<div class="px-4 lg:px-6">
		<ChartAreaInteractive />
	</div>
	<DataTable {data} />
</div>
