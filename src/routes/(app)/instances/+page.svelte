<script lang="ts">
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import {
		createInstance,
		deleteInstance,
		killInstance,
		listInstances,
		minecraftVersions,
		nextPort,
		startInstance,
		stopInstance
	} from '#lib/instances.remote.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Form from '#lib/components/form/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { createInstanceSchema } from '#lib/schemas/instance.js';
	import ExternalLink from '@tabler/icons-svelte/icons/external-link';

	const instances = $derived(await listInstances());
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

	let createOpen = $state(false);
	const creating = $derived(createInstance.pending > 0);
	let deleting = $state<{ id: number; name: string } | null>(null);

	async function openCreate() {
		createInstance.fields.set({ loader: 'vanilla', ramMaxMb: 2048, port: await nextPort() });
		createOpen = true;
	}

	async function run(action: (id: number) => Promise<void>, id: number) {
		try {
			await action(id);
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Action failed');
		}
	}

	const badge = {
		running: 'default',
		stopping: 'secondary',
		exited: 'outline',
		stopped: 'outline'
	} as const;
</script>

<svelte:head><title>Instances · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<div class="flex items-center justify-between">
		<p class="text-sm text-muted-foreground">Create and manage your Minecraft servers.</p>
		<Button onclick={openCreate}><PlusIcon />New instance</Button>
	</div>

	{#if !instances.length}
		<Card.Root>
			<Card.Header>
				<Card.Title>No instances yet</Card.Title>
				<Card.Description>Create your first server to get started.</Card.Description>
			</Card.Header>
		</Card.Root>
	{/if}

	<div class="grid gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3">
		{#each instances ?? [] as inst (inst.id)}
			{@const active = inst.state === 'running' || inst.state === 'stopping'}
			<Card.Root>
				<Card.Header>
					<Card.Title>{inst.name}</Card.Title>
					<Card.Description>
						{inst.loader}
						{inst.mcVersion} · port {inst.port} · {inst.ramMaxMb} MB
					</Card.Description>
					<Card.Action><Badge variant={badge[inst.state]}>{inst.state}</Badge></Card.Action>
				</Card.Header>
				<Card.Footer class="flex flex-wrap gap-2">
					<Button variant="secondary" size="sm" href="/instances/{inst.id}">Console</Button>
					{#if active}
						<Button
							variant="outline"
							size="sm"
							disabled={inst.state === 'stopping'}
							onClickPromise={() => run(stopInstance, inst.id)}
						>
							Stop
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClickPromise={() => run(killInstance, inst.id)}
						>
							Kill
						</Button>
					{:else}
						<Button size="sm" onClickPromise={() => run(startInstance, inst.id)}>Start</Button>
						<Button variant="ghost" size="sm" onclick={() => (deleting = inst)}>Delete</Button>
					{/if}
				</Card.Footer>
			</Card.Root>
		{/each}
	</div>
</div>

<Sheet.Root bind:open={createOpen}>
	<!-- while creating, the sheet stays: leaving would hide the progress and any error -->
	<Sheet.Content
		showCloseButton={!creating}
		onEscapeKeydown={(e) => creating && e.preventDefault()}
		onInteractOutside={(e) => creating && e.preventDefault()}
	>
		<Sheet.Header>
			<Sheet.Title>New instance</Sheet.Title>
			<Sheet.Description>
				The server jar is downloaded from the loader's official source.
			</Sheet.Description>
		</Sheet.Header>
		<Form.Root
			schema={createInstanceSchema}
			remoteFunction={createInstance}
			class="flex flex-col gap-4 px-4"
			onSubmitted={(succeeded) => {
				if (succeeded) createOpen = false;
			}}
		>
			{#snippet children({ pending })}
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
					<Form.Checkbox field={eulaAccepted}>
						I accept the
						<a
							href="https://www.minecraft.net/eula"
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-0.5 underline underline-offset-4 hover:text-foreground"
						>
							Minecraft EULA
							<ExternalLink class="inline size-5" />
						</a>
					</Form.Checkbox>
					<Form.Errors form={createInstance} />
				</Field.Group>
				<Sheet.Footer class="p-0">
					<Button type="submit" loading={pending > 0}>Create instance</Button>
				</Sheet.Footer>
			{/snippet}
		</Form.Root>
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root open={!!deleting} onOpenChange={(o) => !o && (deleting = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {deleting?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently removes the instance and its world files.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					const id = deleting!.id;
					deleting = null;
					run(deleteInstance, id);
				}}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
