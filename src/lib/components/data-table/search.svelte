<script lang="ts">
	import SearchIcon from '@tabler/icons-svelte/icons/search';

	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { cn } from '#lib/utils.js';

	import { useTableContext } from './hook.js';

	let {
		placeholder = 'Search',
		label = placeholder,
		class: className
	}: { placeholder?: string; label?: string; class?: string } = $props();

	const table = useTableContext();

	// Server-side tables wait for a pause in typing, so each keystroke isn't a request.
	const delay = table.options.manualFiltering ? 300 : 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	// What's in the box. Follows the table's search (say, after "Clear filters"), and leads it
	// while the user types.
	let text = $derived((table.atoms.globalFilter.get() as string | undefined) ?? '');

	function search(value: string) {
		text = value;
		clearTimeout(timer);
		timer = setTimeout(() => {
			table.setGlobalFilter(value);
			table.setPageIndex(0);
		}, delay);
	}
</script>

<InputGroup.Root class={cn('w-full @lg/data-table:w-64', className)}>
	<InputGroup.Addon>
		<SearchIcon />
	</InputGroup.Addon>
	<InputGroup.Input
		type="search"
		aria-label={label}
		{placeholder}
		bind:value={() => text, search}
	/>
</InputGroup.Root>
