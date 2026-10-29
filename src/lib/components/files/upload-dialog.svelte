<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { uploadFiles } from '#lib/files.remote.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import Uploader from '#lib/components/uploader/uploader.svelte';
	import { discardLarge, uploadLarge } from '#lib/upload-large.js';
	import { MAX_FILE_BYTES } from '#lib/upload-limits.js';

	let {
		open = $bindable(false),
		instanceId,
		path
	}: { open?: boolean; instanceId: number; path: string } = $props();

	// leaving mid-upload would hide the progress
	let busy = $state(false);
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="sm:max-w-xl"
		showCloseButton={!busy}
		onEscapeKeydown={(e) => busy && e.preventDefault()}
		onInteractOutside={(e) => busy && e.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>Upload files</Dialog.Title>
			<Dialog.Description>
				Into <code class="font-mono">/{path}</code>. Files with the same name are replaced.
			</Dialog.Description>
		</Dialog.Header>
		<!-- remounted per opening so every visit starts with an empty queue -->
		{#if open}
			<Uploader
				bind:busy
				maxFileBytes={MAX_FILE_BYTES}
				upload={(items) => uploadFiles({ id: instanceId, path, items })}
				uploadLarge={(item, onBytes, signal) =>
					uploadLarge(item, { instanceId, path }, onBytes, signal)}
				discard={(item) => void discardLarge(item, { instanceId, path })}
				onDone={(count) => {
					toast.success(`Uploaded ${count} ${count === 1 ? 'file' : 'files'}`);
					open = false;
				}}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
