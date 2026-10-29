<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { deleteInstance, getInstance, updateInstance } from '#lib/instances.remote.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const instance = $derived(getInstance(id));
	const { name, port, ramMinMb, ramMaxMb, jvmArgs, autoStart } = updateInstance.fields;

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
			jvmArgs: i.jvmArgs,
			autoStart: i.autoStart
		});
	});

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
			<form
				{...updateInstance.enhance(async ({ submit }) => {
					await submit();
					if (!updateInstance.fields.allIssues()?.length) toast.success('Settings saved');
				})}
			>
				<input {...updateInstance.fields.id.as('number')} type="hidden" />
				<Field.Group>
					<Field.Field data-invalid={!!name.issues()?.length}>
						<Field.Label for="name">Name</Field.Label>
						<Input id="name" {...name.as('text')} />
						<Field.Error errors={name.issues()} />
					</Field.Field>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Field.Field data-invalid={!!port.issues()?.length}>
							<Field.Label for="port">Port</Field.Label>
							<Input id="port" {...port.as('number')} />
							<Field.Error errors={port.issues()} />
						</Field.Field>
						<Field.Field data-invalid={!!ramMinMb.issues()?.length}>
							<Field.Label for="ramMin">Min RAM (MB)</Field.Label>
							<Input id="ramMin" {...ramMinMb.as('number')} />
							<Field.Error errors={ramMinMb.issues()} />
						</Field.Field>
						<Field.Field data-invalid={!!ramMaxMb.issues()?.length}>
							<Field.Label for="ramMax">Max RAM (MB)</Field.Label>
							<Input id="ramMax" {...ramMaxMb.as('number')} />
							<Field.Error errors={ramMaxMb.issues()} />
						</Field.Field>
					</div>
					<Field.Field data-invalid={!!jvmArgs.issues()?.length}>
						<Field.Label for="jvmArgs">JVM arguments</Field.Label>
						<Input
							id="jvmArgs"
							class="font-mono"
							placeholder="-XX:+UseG1GC"
							{...jvmArgs.as('text')}
						/>
						<Field.Description>Added after the memory flags, separated by spaces.</Field.Description
						>
						<Field.Error errors={jvmArgs.issues()} />
					</Field.Field>
					<Field.Field orientation="horizontal">
						<input id="autoStart" class="size-4 accent-primary" {...autoStart.as('checkbox')} />
						<Field.Label for="autoStart" class="font-normal">
							Start automatically when the panel starts
						</Field.Label>
					</Field.Field>
					<Field.Error errors={updateInstance.fields.allIssues()} />
					<div>
						<Button type="submit" loading={updateInstance.pending > 0}>Save changes</Button>
					</div>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Delete instance</Card.Title>
			<Card.Description>
				Permanently removes the instance and its world files. The server must be stopped.
			</Card.Description>
		</Card.Header>
		<Card.Footer>
			<Button variant="destructive" onclick={() => (confirmDelete = true)}>Delete instance</Button>
		</Card.Footer>
	</Card.Root>
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
