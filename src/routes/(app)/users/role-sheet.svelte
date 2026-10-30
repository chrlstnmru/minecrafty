<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		INSTANCE_PERMISSIONS,
		MAX_RANK,
		PANEL_PERMISSIONS,
		emptyRules,
		registry,
		type Permission,
		type RoleRules
	} from '#lib/permissions.js';
	import { addRole, saveRole } from '#lib/roles.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	type Editing = { id?: number; name: string; description: string; rank: number; rules: RoleRules };
	type Stance = 'allow' | 'unset' | 'deny';

	let {
		role,
		open = $bindable(false),
		isAdmin
	}: { role: Editing | null; open: boolean; isAdmin: boolean } = $props();

	let name = $state('');
	let description = $state('');
	let rank = $state(10);
	let stance = $state<Record<string, Stance>>({});
	let saving = $state(false);

	// load the role being edited each time the sheet opens
	$effect(() => {
		if (!open) return;
		const rules = role?.rules ?? emptyRules();
		name = role?.name ?? '';
		description = role?.description ?? '';
		rank = role?.rank ?? 10;
		stance = Object.fromEntries(
			[...INSTANCE_PERMISSIONS, ...PANEL_PERMISSIONS].map((p) => [
				p,
				rules.deny.includes(p) ? 'deny' : rules.allow.includes(p) ? 'allow' : 'unset'
			])
		);
	});

	// a role with nothing allowed grants nothing; panel-only roles are fine
	const canSave = $derived(
		Object.values(stance).some((s) => s === 'allow') && Number.isInteger(rank)
	);

	async function save() {
		const pick = (s: Stance) =>
			(Object.keys(stance) as Permission[]).filter((p) => stance[p] === s);
		const input = {
			name,
			description,
			rank,
			rules: { allow: pick('allow'), deny: pick('deny') }
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
				Deny beats allow; Not set is not granted. A permission brings what it needs, so anything on
				a server includes View.
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
				<div class="grid gap-1.5">
					<Label for="role-rank">Rank (0 to {MAX_RANK})</Label>
					<Input id="role-rank" type="number" min={0} max={MAX_RANK} bind:value={rank} />
					<p class="text-xs text-muted-foreground">
						{isAdmin
							? 'Anyone who manages roles can only give, edit or delete roles ranked below their own.'
							: 'It must be below your own rank.'}
					</p>
				</div>
			</div>

			{@render group(
				'On a server',
				'Applies to the server a role is given on, or to every server when given panel-wide.',
				INSTANCE_PERMISSIONS
			)}
			{@render group(
				'On the panel',
				'Only applies when the role is given panel-wide.',
				PANEL_PERMISSIONS
			)}
		</div>
		<Sheet.Footer class="border-t">
			{#if !canSave}
				<p class="text-xs text-muted-foreground">Allow at least one permission to save the role.</p>
			{/if}
			<Button loading={saving} disabled={!canSave} onclick={save}>
				{role?.id ? 'Save role' : 'Create role'}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>

{#snippet group(title: string, hint: string, keys: readonly Permission[])}
	<section class="grid gap-3">
		<div>
			<h3 class="text-sm font-medium">{title}</h3>
			<p class="text-xs text-muted-foreground">{hint}</p>
		</div>
		{#each keys as permission (permission)}
			<div class="flex items-center gap-3">
				<div class="min-w-0 flex-1">
					<div class="text-sm">
						{registry[permission].label}
						{#if registry[permission].ownerOnlyGrant}
							<span class="text-xs text-muted-foreground">(admins only can grant)</span>
						{/if}
					</div>
					<div class="text-xs text-muted-foreground">{registry[permission].description}</div>
				</div>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					value={stance[permission]}
					onValueChange={(next) => next && (stance[permission] = next as Stance)}
					aria-label={registry[permission].label}
				>
					<ToggleGroup.Item
						value="allow"
						class="data-[state=on]:bg-success/20 data-[state=on]:text-success"
					>
						Allow
					</ToggleGroup.Item>
					<ToggleGroup.Item value="unset" class="data-[state=on]:bg-foreground/15">
						Not set
					</ToggleGroup.Item>
					<ToggleGroup.Item
						value="deny"
						class="data-[state=on]:bg-danger/20 data-[state=on]:text-danger"
					>
						Deny
					</ToggleGroup.Item>
				</ToggleGroup.Root>
			</div>
		{/each}
	</section>
{/snippet}
