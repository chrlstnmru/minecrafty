<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		PERMISSIONS,
		PERMISSION_INFO,
		SETTING_FIELDS,
		SETTING_INFO,
		emptyRules,
		type Permission,
		type RoleRules,
		type SettingField
	} from '#lib/permissions.js';
	import { addRole, saveRole } from '#lib/roles.remote.js';
	import { propertyGroups } from '#lib/server-properties-catalog.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	type Editing = { id?: number; name: string; description: string; rules: RoleRules };

	let { role, open = $bindable(false) }: { role: Editing | null; open: boolean } = $props();

	type Stance = 'allow' | 'unset' | 'deny';

	let name = $state('');
	let description = $state('');
	let stance = $state<Record<string, Stance>>({});
	let lockedSettings = $state<SettingField[]>([]);
	let lockedProperties = $state<string[]>([]);
	let extraKey = $state('');
	let saving = $state(false);

	// load the role being edited each time the sheet opens
	$effect(() => {
		if (!open) return;
		const r = role?.rules ?? emptyRules();
		name = role?.name ?? '';
		description = role?.description ?? '';
		stance = Object.fromEntries(
			PERMISSIONS.map((p) => [
				p,
				r.deny.includes(p) ? 'deny' : r.allow.includes(p) ? 'allow' : 'unset'
			])
		);
		lockedSettings = [...r.lockedSettings];
		lockedProperties = [...r.lockedProperties];
		extraKey = '';
	});

	const known = new Set(propertyGroups.flatMap((g) => g.fields.map((f) => f.key)));
	const extras = $derived(lockedProperties.filter((k) => !known.has(k)));

	const toggle = <T>(list: T[], item: T, on: boolean) =>
		on ? [...list.filter((i) => i !== item), item] : list.filter((i) => i !== item);

	function addExtra() {
		const key = extraKey.trim();
		if (!/^[A-Za-z0-9._-]{1,100}$/.test(key)) return toast.error('Not a valid property name');
		lockedProperties = toggle(lockedProperties, key, true);
		extraKey = '';
	}

	async function save() {
		const pick = (s: Stance) => PERMISSIONS.filter((p): p is Permission => stance[p] === s);
		const input = {
			name,
			description,
			rules: {
				allow: pick('allow'),
				deny: pick('deny'),
				lockedProperties,
				lockedSettings
			}
		};
		saving = true;
		try {
			if (role?.id) await saveRole({ id: role.id, ...input });
			else await addRole(input);
			toast.success(role?.id ? 'Role saved' : 'Role created');
			open = false;
		} catch (e) {
			toast.error(
				(e as { body?: { message?: string } }).body?.message ?? 'Could not save the role'
			);
		} finally {
			saving = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full gap-0 sm:max-w-xl">
		<Sheet.Header>
			<Sheet.Title>{role?.id ? 'Edit role' : 'New role'}</Sheet.Title>
			<Sheet.Description>
				A role is what a user may do on a server. Deny beats allow; a permission left unset is not
				granted.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-1 scrollbar-subtle flex-col gap-6 overflow-y-auto p-4">
			<div class="grid gap-3">
				<div class="grid gap-1.5">
					<Label for="role-name">Name</Label>
					<Input id="role-name" bind:value={name} maxlength={40} autocomplete="off" />
				</div>
				<div class="grid gap-1.5">
					<Label for="role-description">Description</Label>
					<Input
						id="role-description"
						bind:value={description}
						maxlength={200}
						autocomplete="off"
					/>
				</div>
			</div>

			<section class="grid gap-3">
				<h3 class="text-sm font-medium">Permissions</h3>
				{#each PERMISSIONS as permission (permission)}
					<div class="flex items-center gap-3">
						<div class="min-w-0 flex-1">
							<div class="text-sm">{PERMISSION_INFO[permission].label}</div>
							<div class="text-xs text-muted-foreground">
								{PERMISSION_INFO[permission].description}
							</div>
						</div>
						<ToggleGroup.Root
							type="single"
							variant="outline"
							size="sm"
							value={stance[permission]}
							onValueChange={(next) => next && (stance[permission] = next as Stance)}
							aria-label={PERMISSION_INFO[permission].label}
						>
							<ToggleGroup.Item value="allow">Allow</ToggleGroup.Item>
							<ToggleGroup.Item value="unset">Not set</ToggleGroup.Item>
							<ToggleGroup.Item value="deny">Deny</ToggleGroup.Item>
						</ToggleGroup.Root>
					</div>
				{/each}
			</section>

			<section class="grid gap-3">
				<div>
					<h3 class="text-sm font-medium">Locked settings</h3>
					<p class="text-xs text-muted-foreground">
						Shown read-only in Settings; the server ignores a change to them.
					</p>
				</div>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each SETTING_FIELDS as field (field)}
						<div class="flex items-start gap-2">
							<Checkbox
								id="lock-setting-{field}"
								checked={lockedSettings.includes(field)}
								onCheckedChange={(on) =>
									(lockedSettings = toggle(lockedSettings, field, on === true))}
							/>
							<Label for="lock-setting-{field}" class="flex flex-col items-start gap-0.5">
								<span>{SETTING_INFO[field].label}</span>
								<span class="text-xs font-normal text-muted-foreground">
									{SETTING_INFO[field].description}
								</span>
							</Label>
						</div>
					{/each}
				</div>
			</section>

			<section class="grid gap-3">
				<div>
					<h3 class="text-sm font-medium">Locked server.properties keys</h3>
					<p class="text-xs text-muted-foreground">
						Shown read-only in Properties. Files can still edit the file; deny Files to prevent
						that.
					</p>
				</div>
				{#each propertyGroups as group (group.title)}
					<div class="grid gap-2">
						<div class="text-xs font-medium text-muted-foreground">{group.title}</div>
						<div class="grid gap-2 sm:grid-cols-2">
							{#each group.fields as field (field.key)}
								<div class="flex items-center gap-2">
									<Checkbox
										id="lock-prop-{field.key}"
										checked={lockedProperties.includes(field.key)}
										onCheckedChange={(on) =>
											(lockedProperties = toggle(lockedProperties, field.key, on === true))}
									/>
									<Label for="lock-prop-{field.key}" class="font-normal">{field.label}</Label>
								</div>
							{/each}
						</div>
					</div>
				{/each}
				<div class="grid gap-2">
					<div class="text-xs font-medium text-muted-foreground">Other keys</div>
					<div class="flex flex-wrap gap-1.5">
						{#each extras as key (key)}
							<Button
								variant="secondary"
								size="xs"
								class="font-mono"
								onclick={() => (lockedProperties = toggle(lockedProperties, key, false))}
								aria-label="Unlock {key}"
							>
								{key} ✕
							</Button>
						{/each}
					</div>
					<form
						class="flex gap-2"
						onsubmit={(e) => {
							e.preventDefault();
							addExtra();
						}}
					>
						<Input
							bind:value={extraKey}
							placeholder="a key not listed above"
							class="font-mono"
							aria-label="Property key to lock"
							autocomplete="off"
						/>
						<Button type="submit" variant="outline">Lock</Button>
					</form>
				</div>
			</section>
		</div>
		<Sheet.Footer class="border-t">
			<Button loading={saving} onclick={save}>{role?.id ? 'Save role' : 'Create role'}</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
