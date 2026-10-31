<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	import { createLocalPack, packMinecraftVersions } from '#lib/builder.remote.js';
	import Combobox from '#lib/components/combobox.svelte';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { PACK_LOADERS, type PackLoader } from '#lib/pack-loaders.js';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let name = $state('');
	let loader = $state<PackLoader>('fabric');
	let mcVersion = $state('');
	let saving = $state(false);

	const versions = $derived(packMinecraftVersions(loader));
	const options = $derived((versions.current ?? []).map((v) => ({ value: v, label: v })));

	// the newest version of the loader unless one was picked that it still has
	$effect(() => {
		const list = versions.current;
		if (list?.length && !list.includes(mcVersion)) mcVersion = list[0];
	});

	// a fresh form each time it opens
	$effect(() => {
		if (open) name = '';
	});

	async function create() {
		saving = true;
		try {
			const { id } = await createLocalPack({ name, loader, mcVersion });
			open = false;
			await goto(`/modpacks/${id}`);
		} catch (e) {
			toast.error(
				(e as { body?: { message?: string } }).body?.message ?? 'Could not create the pack'
			);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New modpack</Dialog.Title>
			<Dialog.Description>
				Pick the loader and Minecraft version first; mods are chosen to match them.
			</Dialog.Description>
		</Dialog.Header>
		<Field.Group>
			<Field.Field>
				<Field.Label for="pack-name">Name</Field.Label>
				<Input
					id="pack-name"
					bind:value={name}
					maxlength={60}
					placeholder="Survival pack"
					autocomplete="off"
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="pack-loader">Loader</Field.Label>
				<SelectMenu
					id="pack-loader"
					options={PACK_LOADERS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
					bind:value={loader}
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="pack-mc">Minecraft version</Field.Label>
				<Combobox id="pack-mc" {options} bind:value={mcVersion} placeholder="Choose a version" />
			</Field.Field>
		</Field.Group>
		<Dialog.Footer>
			<Button loading={saving} disabled={!name.trim() || !mcVersion} onclick={create}>
				Create pack
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
