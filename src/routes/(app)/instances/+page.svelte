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
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';

	const instances = listInstances();
	const { name, loader, mcVersion, port, ramMaxMb, eulaAccepted } = createInstance.fields;

	type LoaderId = 'vanilla' | 'paper' | 'purpur';
	const selectedLoader = $derived((loader.value() || 'vanilla') as LoaderId);
	const versions = $derived(minecraftVersions(selectedLoader));
	// keep the picker on a valid choice (newest first) when the loader changes
	$effect(() => {
		const list = versions.current;
		if (list?.length && !list.includes(mcVersion.value() ?? '')) mcVersion.set(list[0]);
	});

	let createOpen = $state(false);
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

	{#if !instances.current?.length}
		<Card.Root>
			<Card.Header>
				<Card.Title>No instances yet</Card.Title>
				<Card.Description>Create your first server to get started.</Card.Description>
			</Card.Header>
		</Card.Root>
	{/if}

	<div class="grid gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3">
		{#each instances.current ?? [] as inst (inst.id)}
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
	<Sheet.Content>
		<Sheet.Header>
			<Sheet.Title>New instance</Sheet.Title>
			<Sheet.Description>
				The server jar is downloaded from the loader's official source.
			</Sheet.Description>
		</Sheet.Header>
		<form
			class="flex flex-col gap-4 px-4"
			{...createInstance.enhance(async ({ submit }) => {
				await submit();
				if (!createInstance.fields.allIssues()?.length) createOpen = false;
			})}
		>
			<Field.Group>
				<Field.Field data-invalid={!!name.issues()?.length}>
					<Field.Label for="name">Name</Field.Label>
					<Input id="name" {...name.as('text')} />
					<Field.Error errors={name.issues()} />
				</Field.Field>
				<Field.Field data-invalid={!!loader.issues()?.length}>
					<Field.Label for="loader">Loader</Field.Label>
					<NativeSelect id="loader" {...loader.as('select')}>
						<NativeSelectOption value="vanilla">Vanilla</NativeSelectOption>
						<NativeSelectOption value="paper">Paper</NativeSelectOption>
						<NativeSelectOption value="purpur">Purpur</NativeSelectOption>
					</NativeSelect>
					<Field.Error errors={loader.issues()} />
				</Field.Field>
				<Field.Field data-invalid={!!mcVersion.issues()?.length}>
					<Field.Label for="mcVersion">Minecraft version</Field.Label>
					<NativeSelect id="mcVersion" disabled={!versions.current} {...mcVersion.as('select')}>
						{#each versions.current ?? [] as v (v)}
							<NativeSelectOption value={v}>{v}</NativeSelectOption>
						{/each}
					</NativeSelect>
					<Field.Error errors={mcVersion.issues()} />
				</Field.Field>
				<div class="grid grid-cols-2 gap-4">
					<Field.Field data-invalid={!!port.issues()?.length}>
						<Field.Label for="port">Port</Field.Label>
						<Input id="port" {...port.as('number')} />
						<Field.Error errors={port.issues()} />
					</Field.Field>
					<Field.Field data-invalid={!!ramMaxMb.issues()?.length}>
						<Field.Label for="ram">Max RAM (MB)</Field.Label>
						<Input id="ram" {...ramMaxMb.as('number')} />
						<Field.Error errors={ramMaxMb.issues()} />
					</Field.Field>
				</div>
				<Field.Field orientation="horizontal" data-invalid={!!eulaAccepted.issues()?.length}>
					<input id="eula" class="size-4 accent-primary" {...eulaAccepted.as('checkbox')} />
					<Field.Label for="eula" class="font-normal">
						I accept the Minecraft EULA (aka.ms/MinecraftEULA)
					</Field.Label>
				</Field.Field>
				<Field.Error errors={eulaAccepted.issues()} />
				<Field.Error errors={createInstance.fields.allIssues()} />
			</Field.Group>
			<Sheet.Footer class="p-0">
				<Button type="submit" loading={createInstance.pending > 0}>Create instance</Button>
			</Sheet.Footer>
		</form>
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
