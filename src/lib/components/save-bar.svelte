<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';

	import { Button } from '#lib/components/ui/button/index.js';

	let {
		subject,
		changeCount,
		error,
		saving,
		canSave,
		onsave,
		ondiscard,
		noun = ['change', 'changes'],
		saveLabel = 'Save changes',
		discardLabel = 'Discard'
	}: {
		/** What the changes are to, named after the count ("3 unsaved changes to server.properties"). */
		subject?: string;
		changeCount: number;
		error?: string;
		saving: boolean;
		canSave: boolean;
		onsave: () => void;
		ondiscard: () => void;
		/** What is counted, as [one, many]; changes by default. */
		noun?: [string, string];
		saveLabel?: string;
		discardLabel?: string;
	} = $props();
</script>

<!-- Floats over the page like a toast, so it stays in reach however far the page scrolls. -->
<div
	class="pointer-events-none fixed inset-x-4 bottom-6 z-40 flex justify-center"
	transition:fly={{ y: 16, duration: prefersReducedMotion.current ? 0 : 160 }}
>
	<div
		class="pointer-events-auto flex w-full max-w-lg flex-wrap items-center gap-3 rounded-xl border bg-popover py-2.5 ps-4 pe-2.5 text-popover-foreground shadow-lg"
	>
		<p class="min-w-0 flex-1 text-xs/relaxed" aria-live="polite">
			{#if error}
				<span class="text-destructive">{error}</span>
			{:else}
				{changeCount} unsaved {changeCount === 1 ? noun[0] : noun[1]}
				{#if subject}to <span class="font-semibold">{subject}</span>{/if}
			{/if}
		</p>
		<div class="flex gap-1.5">
			<Button variant="ghost" size="sm" onclick={ondiscard} disabled={saving}>{discardLabel}</Button
			>
			<Button size="sm" onclick={onsave} loading={saving} disabled={!canSave}>{saveLabel}</Button>
		</div>
	</div>
</div>
