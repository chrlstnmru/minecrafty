<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	import * as Form from '#lib/components/form/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { isFromPack } from '#lib/instance-origin.js';
	import { deleteInstance, getInstance, updateInstance } from '#lib/instances.remote.js';
	import { updateInstanceSchema } from '#lib/schemas/instance.js';

	import type { PageProps } from './$types';

	import LoaderCard from './loader-card.svelte';
	import ModpackCard from './modpack-card.svelte';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const instance = $derived(await getInstance(id));
	const granted = $derived(instance.permissions);
	const showPack = $derived(granted.includes('modpack') && isFromPack(instance));
	const { name, port, ramMinMb, ramMaxMb, javaMajor, jvmArgs, autoStart } = updateInstance.fields;
	const defaultFormValues = () => ({
		id: instance.id,
		name: instance.name,
		port: instance.port,
		ramMinMb: instance.ramMinMb,
		ramMaxMb: instance.ramMaxMb,
		javaMajor: (instance.javaMajor ? String(instance.javaMajor) : '') as
			| ''
			| '8'
			| '17'
			| '21'
			| '25',
		jvmArgs: instance.jvmArgs,
		autoStart: instance.autoStart
	});
	updateInstance.fields.set(defaultFormValues());

	const javaOptions = [
		{ value: '', label: 'Automatic (from Minecraft version)' },
		...[8, 17, 21, 25].map((v) => ({ value: String(v), label: `Java ${v}` }))
	];

	let { data }: PageProps = $props();
	let confirmDelete = $state(false);

	async function remove() {
		confirmDelete = false;
		try {
			await deleteInstance(id);
			await goto('/instances');
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Delete failed');
		}
	}
</script>

<div class="grid max-w-2xl gap-4">
	{#if granted.includes('settings')}
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
								description={data.user.role === 'owner'
									? 'Added after the memory flags, separated by spaces.'
									: 'Only the owner may change these: a JVM flag can run commands on the host.'}
								readonly={data.user.role !== 'owner'}
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
	{/if}

	{#if granted.includes('loader')}<LoaderCard />{/if}
	{#if showPack}<ModpackCard />{/if}

	{#if data.panel.includes('instances.delete')}
		<Card.Root>
			<Card.Header>
				<Card.Title>Delete instance</Card.Title>
				<Card.Description>
					Permanently removes the instance and its world files. The server must be stopped.
				</Card.Description>
			</Card.Header>
			<Card.Footer>
				<Button variant="destructive-ghost" onclick={() => (confirmDelete = true)}
					>Delete instance</Button
				>
			</Card.Footer>
		</Card.Root>
	{/if}
</div>

<AlertDialog.Root bind:open={confirmDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {instance.name}?</AlertDialog.Title>
			<AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
