<script lang="ts">
	import { onMount } from 'svelte';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import { toast } from 'svelte-sonner';
	import { uploadPack } from '#lib/packs.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';

	let {
		instanceId,
		kind,
		noun,
		hint
	}: {
		instanceId: number;
		kind: 'resourcepack' | 'shader';
		noun: string;
		hint: string;
	} = $props();

	const { file } = uploadPack.fields;
	// the input's `files` is read from the DOM when the form is submitted, so it is not bound here
	const fileAttrs = $derived.by(() => {
		const { files: _files, ...rest } = file.as('file');
		return rest;
	});
	let formEl = $state<HTMLFormElement>();

	// the address the admin is using; the server turns it into the pack's download URL
	let origin = $state('');
	onMount(() => (origin = location.origin));
</script>

<form
	bind:this={formEl}
	enctype="multipart/form-data"
	{...uploadPack.enhance(async ({ submit }) => {
		try {
			await submit();
			if (uploadPack.fields.allIssues()?.length) return;
			toast.success(`Uploaded ${noun}`);
			formEl?.reset();
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Upload failed');
		}
	})}
>
	<!-- explicit values so the fields survive the form reset after a successful upload -->
	<input {...uploadPack.fields.id.as('number')} type="hidden" value={instanceId} />
	<input {...uploadPack.fields.kind.as('text')} type="hidden" value={kind} />
	<input {...uploadPack.fields.origin.as('text')} type="hidden" value={origin} />
	<Field.Field data-invalid={!!file.issues()?.length}>
		<Field.Label for="pack-file">Upload a {noun} (.zip)</Field.Label>
		<div class="flex gap-2">
			<!-- not the shadcn Input: it binds `value` on file inputs, which clears the chosen file -->
			<input
				id="pack-file"
				accept=".zip,application/zip"
				class="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
				{...fileAttrs}
			/>
			<Button type="submit" variant="outline" loading={uploadPack.pending > 0}>
				<UploadIcon />Upload
			</Button>
		</div>
		<Field.Description>{hint}</Field.Description>
		<Field.Error errors={file.issues()} />
	</Field.Field>
</form>
