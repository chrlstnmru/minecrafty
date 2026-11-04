<script lang="ts">
	import { page } from '$app/state';
	import GamepadIcon from '@tabler/icons-svelte/icons/device-gamepad-2';
	import GaugeIcon from '@tabler/icons-svelte/icons/gauge';
	import SettingsIcon from '@tabler/icons-svelte/icons/settings';
	import ShieldLockIcon from '@tabler/icons-svelte/icons/shield-lock';
	import WorldIcon from '@tabler/icons-svelte/icons/world';
	import { toast } from 'svelte-sonner';

	import SaveBar from '#lib/components/save-bar.svelte';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { saveServerProperties, serverProperties } from '#lib/properties.remote.js';
	import {
		MANAGED_KEYS,
		propertyFields,
		propertyGroups,
		validateProperty,
		type PropertyField
	} from '#lib/server-properties-catalog.js';
	import { UrlParam } from '#lib/url-param.svelte.js';

	import PropertiesFile from './properties-file.svelte';

	const id = $derived(Number(page.params.id));
	const properties = $derived(serverProperties(id));
	const view = new UrlParam('view', 'form');

	const defaults = Object.fromEntries([...propertyFields.values()].map((f) => [f.key, f.default]));
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

	let fileDirty = $state(false);
	// each view keeps its own unsaved edits, so switching waits until they are saved or discarded
	const dirty = $derived(changed.length > 0 || fileDirty);

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

<div
	class={view.value === 'file' ? 'flex min-h-0 flex-1 flex-col gap-4' : 'grid max-w-2xl gap-4 pb-4'}
>
	<div class="sticky -top-1 z-10 -mx-1 -my-1 flex flex-wrap items-center gap-3 bg-background p-1">
		<Tabs.Root value={view.value} onValueChange={(next) => !dirty && (view.value = next)}>
			<Tabs.List aria-label="Edit as">
				<Tabs.Trigger value="form" disabled={dirty && view.value !== 'form'}>Form</Tabs.Trigger>
				<Tabs.Trigger value="file" disabled={dirty && view.value !== 'file'}>File</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
		{#if dirty}
			<span class="text-sm text-muted-foreground">Save or discard your changes to switch.</span>
		{/if}
	</div>

	{#if properties.current && !properties.current.exists}
		<p class="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" role="status">
			This server has not created its server.properties yet. Values you save are written now, and
			the server fills in the rest the first time it starts.
		</p>
	{:else if properties.current?.running}
		<p class="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" role="status">
			The server is running. Changes apply the next time it starts.
		</p>
	{/if}

	{#if view.value === 'file'}
		<PropertiesFile {id} bind:dirty={fileDirty} />
	{:else if !properties.current}
		{#each [0, 1, 2, 3] as i (i)}
			<Card.Root>
				<Card.Header><Skeleton class="h-5 w-32" /></Card.Header>
				<Card.Content class="grid gap-4">
					{#each [0, 1, 2, 3] as j (j)}<Skeleton class="h-9" />{/each}
				</Card.Content>
			</Card.Root>
		{/each}
	{:else}
		{#each propertyGroups as group (group.title)}
			<Card.Root>
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
			<Card.Root>
				<Card.Header>
					<Card.Title>Other properties</Card.Title>
					<Card.Description>
						Keys in the file that have no field here. To add one, switch to File. The port, resource
						pack and RCON are managed in Settings and Resource packs.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<Field.Group class="grid gap-4 sm:grid-cols-2">
						{#each others as key (key)}
							<Field.Field data-invalid={!!errors[key]}>
								<Field.Label for="prop-{key}" class="font-mono text-xs">{key}</Field.Label>
								<Input
									id="prop-{key}"
									class="font-mono"
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
				checked={draft[field.key] === 'true'}
				onCheckedChange={(on) => set(field.key, String(!!on))}
			/>
			<Field.Content>
				<Field.Label for={id} class="font-normal">{field.label}</Field.Label>
				{#if field.description}<Field.Description>{field.description}</Field.Description>{/if}
			</Field.Content>
		</Field.Field>
	{:else}
		<Field.Field data-invalid={!!errors[field.key]}>
			<Field.Label for={id}>{field.label}</Field.Label>
			{#if field.type === 'select'}
				<SelectMenu
					{id}
					value={draft[field.key]}
					options={optionsOf(field)}
					onValueChange={(next) => set(field.key, next)}
				/>
			{:else}
				<Input
					{id}
					type={field.type === 'number' ? 'number' : 'text'}
					min={field.type === 'number' ? field.min : undefined}
					max={field.type === 'number' ? field.max : undefined}
					value={draft[field.key]}
					oninput={(e) => set(field.key, e.currentTarget.value)}
					autocomplete="off"
					aria-invalid={!!errors[field.key]}
				/>
			{/if}
			{#if field.description}<Field.Description>{field.description}</Field.Description>{/if}
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
