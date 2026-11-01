<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';

	import type { UploadItem } from '#lib/upload-entries.js';

	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import Uploader from '#lib/components/uploader/uploader.svelte';
	import { uploadFiles } from '#lib/files.remote.js';
	import { discardLarge, uploadLarge } from '#lib/upload-large.js';
	import { MAX_FILE_BYTES } from '#lib/upload-limits.js';

	let {
		open = $bindable(false),
		instanceId,
		path,
		initial = []
	}: {
		open?: boolean;
		instanceId: number;
		path: string;
		/** files already chosen when it opens, such as ones dropped on a folder */
		initial?: UploadItem[];
	} = $props();

	// leaving mid-upload would hide the progress
	let busy = $state(false);

	// a fresh queue per opening, swapped while the dialog is hidden so closing never reflows it
	let visit = $state(0);
	$effect(() => {
		if (open) untrack(() => visit++);
	});
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
		{#key visit}
			<Uploader
				bind:busy
				{initial}
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
		{/key}
	</Dialog.Content>
</Dialog.Root>
