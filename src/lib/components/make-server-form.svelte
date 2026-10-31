<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	import { installPack } from '#lib/builder.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { nextPort } from '#lib/instances.remote.js';

	/** The name, port, memory and EULA a server made from a builder pack needs, and the button that makes it. */
	let { packId, packName, onDone }: { packId: number; packName: string; onDone?: () => void } =
		$props();

	// svelte-ignore state_referenced_locally
	let name = $state(packName);
	let port = $state(25565);
	let ramMaxMb = $state(4096);
	let eula = $state(false);
	let saving = $state(false);

	const suggested = nextPort();
	$effect(() => {
		if (suggested.current) port = suggested.current;
	});

	async function make() {
		saving = true;
		try {
			await installPack({ id: packId, name, port, ramMaxMb, eulaAccepted: eula });
			onDone?.();
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

<Field.Group>
	<Field.Field>
		<Field.Label for="server-name-{packId}">Name</Field.Label>
		<Input id="server-name-{packId}" bind:value={name} maxlength={60} autocomplete="off" />
	</Field.Field>
	<div class="grid grid-cols-2 gap-4">
		<Field.Field>
			<Field.Label for="server-port-{packId}">Port</Field.Label>
			<Input id="server-port-{packId}" type="number" bind:value={port} min={1024} max={65535} />
		</Field.Field>
		<Field.Field>
			<Field.Label for="server-ram-{packId}">Max RAM (MB)</Field.Label>
			<Input id="server-ram-{packId}" type="number" bind:value={ramMaxMb} min={512} step={512} />
		</Field.Field>
	</div>
	<div class="flex items-center gap-2">
		<Checkbox id="server-eula-{packId}" bind:checked={eula} />
		<Label for="server-eula-{packId}" class="font-normal">
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
	<div>
		<Button loading={saving} disabled={!name.trim() || !eula} onclick={make}>Create server</Button>
	</div>
</Field.Group>
