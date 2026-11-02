<script lang="ts">
	import type { FileDrafts } from '#lib/file-drafts.svelte.js';

	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';

	let {
		drafts,
		allDetail
	}: {
		drafts: FileDrafts;
		/** What "everything" covers besides edits, said when everything is discarded. */
		allDetail?: string;
	} = $props();

	const asked = $derived(drafts.discarding);
	const count = $derived(asked?.all ? drafts.changeCount : (asked?.paths.length ?? 0));
</script>

<AlertDialog.Root
	open={asked !== null}
	onOpenChange={(open) => {
		if (!open) drafts.discarding = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard your changes?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if asked?.all}
					{count}
					{count === 1 ? 'file has' : 'files have'} changes that have not been saved{allDetail
						? `: ${allDetail}`
						: '.'}
				{:else if count > 1}
					{count} files have changes that have not been saved.
				{:else if asked && drafts.byPath[asked.paths[0]]?.isNew}
					This new file has not been saved yet.
				{:else}
					The edits to this file have not been saved.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => drafts.discard()}>Discard</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
