<script lang="ts">
	import type { Snippet } from 'svelte';

	import XIcon from '@tabler/icons-svelte/icons/x';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';

	import { Button } from '#lib/components/ui/button/index.js';

	let {
		label,
		onclear,
		raised = false,
		children
	}: {
		/** What is chosen, such as "2 folders and 3 files". */
		label: string;
		onclear: () => void;
		/** Sits above the save bar, when that one is showing too. */
		raised?: boolean;
		/** The actions on what is chosen. */
		children: Snippet;
	} = $props();
</script>

<div
	class="pointer-events-none fixed inset-x-4 z-40 flex justify-center {raised
		? 'bottom-24'
		: 'bottom-6'}"
	transition:fly={{ y: 16, duration: prefersReducedMotion.current ? 0 : 160 }}
>
	<div
		role="toolbar"
		aria-label="Actions on the chosen files"
		class="pointer-events-auto flex w-full max-w-lg flex-wrap items-center gap-2 rounded-xl border bg-popover py-2 ps-4 pe-2 text-popover-foreground shadow-lg"
	>
		<p class="min-w-0 flex-1 text-xs/relaxed" aria-live="polite">{label} chosen</p>
		<div class="flex items-center gap-1.5">
			{@render children()}
			<Button variant="ghost" size="icon" aria-label="Clear the choice" onclick={onclear}>
				<XIcon />
			</Button>
		</div>
	</div>
</div>
