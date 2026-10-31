<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';

	import MakeServerForm from './make-server-form.svelte';

	let {
		open = $bindable(false),
		packId,
		packName
	}: { open: boolean; packId: number; packName: string } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Make a server from {packName}</Dialog.Title>
			<Dialog.Description>
				It installs the loader, downloads each mod (checking its hash) and copies the pack's config
				files, then is ready to start.
			</Dialog.Description>
		</Dialog.Header>
		{#key open}
			<MakeServerForm {packId} {packName} onDone={() => (open = false)} />
		{/key}
	</Dialog.Content>
</Dialog.Root>
