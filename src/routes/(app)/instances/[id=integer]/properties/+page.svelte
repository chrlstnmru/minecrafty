<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { saveServerProperties, serverProperties } from '#lib/properties.remote.js';
	import {
		MANAGED_KEYS,
		propertyFields,
		propertyGroups,
		validateProperty,
		type PropertyField
	} from '#lib/server-properties-catalog.js';
	import SaveBar from '#lib/components/save-bar.svelte';
	import SettingsIcon from '@tabler/icons-svelte/icons/settings';
	import GaugeIcon from '@tabler/icons-svelte/icons/gauge';
	import WorldIcon from '@tabler/icons-svelte/icons/world';
	import ShieldLockIcon from '@tabler/icons-svelte/icons/shield-lock';
	import GamepadIcon from '@tabler/icons-svelte/icons/device-gamepad-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';

	const id = $derived(Number(page.params.id));
	const properties = $derived(serverProperties(id));

	const defaults = Object.fromEntries([...propertyFields.values()].map((f) => [f.key, f.default]));
	const locked = $derived(new Set(properties.current?.locked ?? []));
	const saved = $derived({ ...defaults, ...properties.current?.values });
	const others = $derived(
		Object.keys(properties.current?.values ?? {})
			.filter((key) => !propertyFields.has(key) && !MANAGED_KEYS.has(key))
			.sort()
	);

	let draft = $derived({ ...saved });
	const set = (key: string, value: string) => (draft = { ...draft, [key]: value });

	const changed = $derived(Object.keys(draft).filter((key) => draft[key] !== saved[key]));
	const errors = $derived(
		Object.fromEntries(
			changed.flatMap((key) => {
				const problem = validateProperty(key, draft[key]);
				return problem ? [[key, problem]] : [];
			})
		)
	);
	const invalid = $derived(Object.keys(errors).length > 0);

	let saving = $state(false);
	async function save() {
		saving = true;
		try {
			await saveServerProperties({
				id,
				values: Object.fromEntries(changed.map((key) => [key, draft[key]]))
			});
			toast.success('Properties saved');
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Save failed');
		} finally {
			saving = false;
		}
	}

	const optionsOf = (field: Extract<PropertyField, { type: 'select' }>) =>
		field.options.some((o) => o.value === draft[field.key])
			? field.options
			: [{ value: draft[field.key], label: draft[field.key] }, ...field.options];
</script>

<svelte:head><title>Properties · Minecrafty</title></svelte:head>

<div class="pb-4 @3xl/main:columns-2 @3xl/main:gap-4">
	{#if properties.current && !properties.current.exists}
		<p
			class="mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground [column-span:all]"
			role="status"
		>
			This server has not created its server.properties yet. Values you save are written now, and
			the server fills in the rest the first time it starts.
		</p>
	{:else if properties.current?.running}
		<p
			class="mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground [column-span:all]"
			role="status"
		>
			The server is running. Changes apply the next time it starts.
		</p>
	{/if}

	{#if !properties.current}
		{#each [0, 1, 2, 3] as i (i)}
			<Card.Root class="mb-4 break-inside-avoid">
				<Card.Header><Skeleton class="h-5 w-32" /></Card.Header>
				<Card.Content class="grid gap-4">
					{#each [0, 1, 2, 3] as j (j)}<Skeleton class="h-9" />{/each}
				</Card.Content>
			</Card.Root>
		{/each}
	{:else}
		{#each propertyGroups as group (group.title)}
			<Card.Root class="mb-4 break-inside-avoid">
				<Card.Header>
					<Card.Title>{group.title}</Card.Title>
					<Card.Description>
						{group.description}
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<Field.Group class="grid gap-4">
						{#each group.fields as field (field.key)}
							{@render control(field)}
						{/each}
					</Field.Group>
				</Card.Content>
			</Card.Root>
		{/each}

		{#if others.length}
			<Card.Root class="mt-4 mb-4 [column-span:all]">
				<Card.Header>
					<Card.Title>Other properties</Card.Title>
					<Card.Description>
						Keys in the file that have no field here. The port, resource pack and RCON are managed
						in Settings and Resource packs.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<Field.Group class="grid gap-4 sm:grid-cols-2 @5xl/main:grid-cols-3">
						{#each others as key (key)}
							<Field.Field data-invalid={!!errors[key]}>
								<Field.Label for="prop-{key}" class="font-mono text-xs">{key}</Field.Label>
								<Input
									id="prop-{key}"
									class="font-mono"
									readonly={locked.has(key)}
									value={draft[key]}
									oninput={(e) => set(key, e.currentTarget.value)}
									autocomplete="off"
								/>
								{#if errors[key]}<Field.Error errors={[{ message: errors[key] }]} />{/if}
							</Field.Field>
						{/each}
					</Field.Group>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

{#snippet control(field: PropertyField)}
	{@const id = `prop-${field.key}`}
	{#if field.type === 'boolean'}
		<Field.Field orientation="horizontal">
			<Checkbox
				{id}
				disabled={locked.has(field.key)}
				checked={draft[field.key] === 'true'}
				onCheckedChange={(on) => set(field.key, String(!!on))}
			/>
			<Field.Content>
				<Field.Label for={id} class="font-normal">{field.label}</Field.Label>
				{#if locked.has(field.key)}
					<Field.Description>Locked by your role.</Field.Description>
				{:else if field.description}<Field.Description>{field.description}</Field.Description>{/if}
			</Field.Content>
		</Field.Field>
	{:else}
		<Field.Field data-invalid={!!errors[field.key]}>
			<Field.Label for={id}>{field.label}</Field.Label>
			{#if field.type === 'select'}
				<SelectMenu
					{id}
					disabled={locked.has(field.key)}
					value={draft[field.key]}
					options={optionsOf(field)}
					onValueChange={(next) => set(field.key, next)}
				/>
			{:else}
				<Input
					{id}
					type={field.type === 'number' ? 'number' : 'text'}
					readonly={locked.has(field.key)}
					min={field.type === 'number' ? field.min : undefined}
					max={field.type === 'number' ? field.max : undefined}
					value={draft[field.key]}
					oninput={(e) => set(field.key, e.currentTarget.value)}
					autocomplete="off"
					aria-invalid={!!errors[field.key]}
				/>
			{/if}
			{#if locked.has(field.key)}
				<Field.Description>Locked by your role.</Field.Description>
			{:else if field.description}<Field.Description>{field.description}</Field.Description>{/if}
			{#if errors[field.key]}<Field.Error errors={[{ message: errors[field.key] }]} />{/if}
		</Field.Field>
	{/if}
{/snippet}

{#if changed.length}
	<SaveBar
		subject="server.properties"
		changeCount={changed.length}
		error={invalid
			? `Fix ${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? 'value' : 'values'} to save`
			: undefined}
		{saving}
		canSave={!invalid}
		onsave={save}
		ondiscard={() => (draft = { ...saved })}
	/>
{/if}
