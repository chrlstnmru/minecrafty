<script lang="ts">
	import type { Header } from '@tanstack/svelte-table';

	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
	import ChevronsUpDownIcon from '@tabler/icons-svelte/icons/selector';
	import { FlexRender } from '@tanstack/svelte-table';

	import { Button } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';

	import type { Features } from './hook.js';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let { header }: { header: Header<Features, any, unknown> } = $props();

	const sorted = $derived(header.column.getIsSorted());
	const end = $derived(header.column.columnDef.meta?.align === 'end');
</script>

<Button
	variant="ghost"
	size="sm"
	class={cn(
		'h-7 gap-1 px-2 font-medium text-inherit',
		end ? '-me-2 flex-row-reverse' : '-ms-2',
		sorted && 'text-foreground'
	)}
	onclick={header.column.getToggleSortingHandler()}
>
	<FlexRender {header} />
	{#if sorted === 'asc'}
		<ArrowUpIcon />
	{:else if sorted === 'desc'}
		<ArrowDownIcon />
	{:else}
		<ChevronsUpDownIcon class="opacity-50" />
	{/if}
</Button>
