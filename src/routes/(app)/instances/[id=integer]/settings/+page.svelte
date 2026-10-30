<script lang="ts">
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { deleteInstance, getInstance, updateInstance } from '#lib/instances.remote.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Form from '#lib/components/form/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { updateInstanceSchema } from '#lib/schemas/instance.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const instance = $derived(getInstance(id));
	const { name, port, ramMinMb, ramMaxMb, javaMajor, jvmArgs, autoStart } = updateInstance.fields;

	// load the stored values into the form when the instance changes or after a save
	$effect(() => {
		const i = instance.current;
		if (!i) return;
		updateInstance.fields.set({
			id: i.id,
			name: i.name,
			port: i.port,
			ramMinMb: i.ramMinMb,
			ramMaxMb: i.ramMaxMb,
			javaMajor: (i.javaMajor ? String(i.javaMajor) : '') as '' | '8' | '17' | '21' | '25',
			jvmArgs: i.jvmArgs,
			autoStart: i.autoStart
		});
	});

	const javaOptions = [
		{ value: '', label: 'Automatic (from Minecraft version)' },
		...[8, 17, 21, 25].map((v) => ({ value: String(v), label: `Java ${v}` }))
	];

	let { data }: PageProps = $props();
	let confirmDelete = $state(false);

	async function remove() {
		try {
			await deleteInstance(id);
			await goto('/instances');
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Delete failed');
		}
	}
</script>

<div class="grid max-w-2xl gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>General</Card.Title>
			<Card.Description>Changes apply the next time the server starts.</Card.Description>
		</Card.Header>
		<Card.Content>
			<Form.Root
				schema={updateInstanceSchema}
				remoteFunction={updateInstance}
				onSubmitted={(succeeded) => {
					if (succeeded) toast.success('Settings saved');
				}}
			>
				{#snippet children({ pending })}
					<input {...updateInstance.fields.id.as('number')} type="hidden" />
					<Field.Group>
						<Form.Input label="Name" field={name} />
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<Form.Input label="Port" type="number" field={port} />
							<Form.Input label="Min RAM (MB)" type="number" field={ramMinMb} />
							<Form.Input label="Max RAM (MB)" type="number" field={ramMaxMb} />
						</div>
						<Form.Select
							label="Java"
							field={javaMajor}
							description="Temurin is downloaded the first time a server needs it."
							options={javaOptions}
						/>
						<Form.Input
							label="JVM arguments"
							field={jvmArgs}
							class="font-mono"
							placeholder="-XX:+UseG1GC"
							description="Added after the memory flags, separated by spaces."
						/>
						<Form.Checkbox field={autoStart} label="Start automatically when the panel starts" />
						<Form.Errors form={updateInstance} />
						<div>
							<Button type="submit" loading={pending > 0}>Save changes</Button>
						</div>
					</Field.Group>
				{/snippet}
			</Form.Root>
		</Card.Content>
	</Card.Root>

	{#if data.user.role === 'admin'}
		<Card.Root>
			<Card.Header>
				<Card.Title>Delete instance</Card.Title>
				<Card.Description>
					Permanently removes the instance and its world files. The server must be stopped.
				</Card.Description>
			</Card.Header>
			<Card.Footer>
				<Button variant="destructive" onclick={() => (confirmDelete = true)}>Delete instance</Button
				>
			</Card.Footer>
		</Card.Root>
	{/if}
</div>

<AlertDialog.Root bind:open={confirmDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {instance.current?.name}?</AlertDialog.Title>
			<AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
