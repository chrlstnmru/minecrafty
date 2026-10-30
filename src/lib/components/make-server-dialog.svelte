<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { installPack } from '#lib/builder.remote.js';
	import { nextPort } from '#lib/instances.remote.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';

	let {
		open = $bindable(false),
		packId,
		packName
	}: { open: boolean; packId: number; packName: string } = $props();

	let name = $state('');
	let port = $state(25565);
	let ramMaxMb = $state(4096);
	let eula = $state(false);
	let saving = $state(false);

	const suggested = nextPort();

	$effect(() => {
		if (!open) return;
		name = packName;
		eula = false;
		if (suggested.current) port = suggested.current;
	});

	async function make() {
		saving = true;
		try {
			await installPack({ id: packId, name, port, ramMaxMb, eulaAccepted: eula });
			open = false;
			toast.success('Creating the server. It installs in the background.');
			await goto('/instances');
		} catch (e) {
			toast.error(
				(e as { body?: { message?: string } }).body?.message ?? 'Could not create the server'
			);
		} finally {
			saving = false;
		}
	}
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
		<Field.Group>
			<Field.Field>
				<Field.Label for="server-name">Name</Field.Label>
				<Input id="server-name" bind:value={name} maxlength={60} autocomplete="off" />
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="server-port">Port</Field.Label>
					<Input id="server-port" type="number" bind:value={port} min={1024} max={65535} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="server-ram">Max RAM (MB)</Field.Label>
					<Input id="server-ram" type="number" bind:value={ramMaxMb} min={512} step={512} />
				</Field.Field>
			</div>
			<div class="flex items-center gap-2">
				<Checkbox id="server-eula" bind:checked={eula} />
				<Label for="server-eula" class="font-normal">
					I accept the
					<a
						href="https://www.minecraft.net/eula"
						target="_blank"
						rel="noopener noreferrer"
						class="underline underline-offset-4 hover:text-foreground"
					>
						Minecraft EULA
					</a>
				</Label>
			</div>
		</Field.Group>
		<Dialog.Footer>
			<Button loading={saving} disabled={!name.trim() || !eula} onclick={make}>Create server</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
