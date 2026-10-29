<script lang="ts">
	import { createInstance, minecraftVersions } from '#lib/instances.remote.js';
	import * as Form from '#lib/components/form/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { createInstanceSchema } from '#lib/schemas/instance.js';
	import EulaCheckbox from './eula-checkbox.svelte';

	let { onDone }: { onDone: () => void } = $props();

	const { name, loader, mcVersion, port, ramMaxMb, eulaAccepted } = createInstance.fields;

	type LoaderId = 'vanilla' | 'paper' | 'purpur' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
	const selectedLoader = $derived((loader.value() || 'vanilla') as LoaderId);
	const versions = $derived(minecraftVersions(selectedLoader));
	// keep the picker on a valid choice (newest first) when the loader changes
	$effect(() => {
		const list = versions.current;
		if (list?.length && !list.includes(mcVersion.value() ?? '')) mcVersion.set(list[0]);
	});

	const loaderOptions: { value: LoaderId; label: string }[] = [
		{ value: 'vanilla', label: 'Vanilla' },
		{ value: 'paper', label: 'Paper' },
		{ value: 'purpur', label: 'Purpur' },
		{ value: 'fabric', label: 'Fabric' },
		{ value: 'quilt', label: 'Quilt' },
		{ value: 'forge', label: 'Forge' },
		{ value: 'neoforge', label: 'NeoForge' }
	];
</script>

<Form.Root
	schema={createInstanceSchema}
	remoteFunction={createInstance}
	class="flex min-h-0 flex-1 flex-col gap-4"
	onSubmitted={(succeeded) => {
		if (succeeded) onDone();
	}}
>
	{#snippet children({ pending })}
		<div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
			<Field.Group>
				<Form.Input label="Name" field={name} />
				<Form.Select label="Loader" field={loader} options={loaderOptions} />
				<Form.Select
					label="Minecraft version"
					field={mcVersion}
					disabled={!versions.current}
					options={(versions.current ?? []).map((v) => ({ value: v, label: v }))}
				/>
				<div class="grid grid-cols-2 gap-4">
					<Form.Input label="Port" type="number" field={port} />
					<Form.Input label="Max RAM (MB)" type="number" field={ramMaxMb} />
				</div>
				<EulaCheckbox field={eulaAccepted} />
				<Form.Errors form={createInstance} />
			</Field.Group>
		</div>
		<div>
			<Button type="submit" class="w-full" loading={pending > 0}>Create instance</Button>
		</div>
	{/snippet}
</Form.Root>
