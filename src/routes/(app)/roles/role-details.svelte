<script lang="ts" module>
	/** Unsaved edits to one role. */
	export interface RoleDraft {
		name: string;
		description: string;
		permissions: string[];
	}
</script>

<script lang="ts">
	import LockIcon from '@tabler/icons-svelte/icons/lock';

	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { PERMISSIONS, permissionGroup, registry, type Permission } from '#lib/permissions.js';
	import { LOCK_MESSAGES, type RoleLock } from '#lib/role-lock.js';
	import { cn } from '#lib/utils.js';

	let {
		class: className,
		role,
		draft = $bindable(),
		isOwner,
		ondelete
	}: {
		class?: string;
		role: {
			id: number;
			name: string;
			description: string;
			memberCount: number;
			permissions: readonly string[];
			lock: RoleLock | null;
		};
		/** Undefined when nothing has changed. */
		draft: RoleDraft | undefined;
		isOwner: boolean;
		ondelete: () => void;
	} = $props();

	let tab = $state('display');

	const name = $derived(draft?.name ?? role.name);
	const description = $derived(draft?.description ?? role.description);
	const selected = $derived(draft?.permissions ?? role.permissions);
	const sections = $derived(
		[...new Set(PERMISSIONS.map(permissionGroup))].map((group) => ({
			group,
			items: PERMISSIONS.filter((p) => permissionGroup(p) === group)
		}))
	);

	/** For each permission implied by a selected one, the label of what includes it. */
	const includedBy = $derived.by(() => {
		const result: Record<string, string> = {};
		const visit = (key: Permission, source: string) => {
			for (const implied of registry[key].implies ?? []) {
				if (implied in result) continue;
				result[implied] = source;
				visit(implied, source);
			}
		};
		for (const key of selected) visit(key as Permission, registry[key as Permission].label);
		return result;
	});

	const isOn = (key: string) => selected.includes(key) || key in includedBy;

	/** Applies an edit, dropping the draft once it matches the saved role again. */
	function edit(patch: Partial<RoleDraft>) {
		const next = { name, description, permissions: [...selected], ...patch };
		const unchanged =
			next.name === role.name &&
			next.description === role.description &&
			next.permissions.length === role.permissions.length &&
			next.permissions.every((k) => role.permissions.includes(k));
		draft = unchanged ? undefined : next;
	}

	function toggle(key: string, checked: boolean) {
		edit({ permissions: checked ? [...selected, key] : selected.filter((k) => k !== key) });
	}
</script>

<section
	class={cn('flex min-w-0 flex-col rounded-xl border bg-card', className)}
	aria-labelledby="role-heading"
>
	<header class="flex flex-col gap-1 px-5 pt-5 pb-4">
		<h2 id="role-heading" class="truncate text-base font-semibold">{role.name}</h2>
		<p class="text-xs text-muted-foreground">
			{role.memberCount}
			{role.memberCount === 1 ? 'person has' : 'people have'} this role
		</p>
		{#if role.lock}
			<p class="mt-2 flex items-center gap-2 text-xs/relaxed text-muted-foreground">
				<LockIcon class="size-3.5 shrink-0" aria-hidden="true" />
				{LOCK_MESSAGES[role.lock]}
			</p>
		{/if}
	</header>

	<Tabs.Root bind:value={tab} class="gap-0">
		<div class="px-5">
			<Tabs.List>
				<Tabs.Trigger value="display" class="px-2.5">Display</Tabs.Trigger>
				<Tabs.Trigger value="permissions" class="px-2.5">Permissions</Tabs.Trigger>
			</Tabs.List>
		</div>

		<Tabs.Content value="display" class="flex flex-col gap-5 px-5 pt-5 pb-6">
			<Field.Field class="max-w-sm">
				<Field.Label for="role-name-{role.id}">Name</Field.Label>
				<Input
					id="role-name-{role.id}"
					value={name}
					oninput={(event) => edit({ name: event.currentTarget.value })}
					disabled={!!role.lock}
					maxlength={40}
					autocomplete="off"
					aria-invalid={!name.trim() || undefined}
				/>
				{#if !name.trim()}
					<Field.Error errors={[{ message: 'Enter a name for the role.' }]} />
				{:else}
					<Field.Description>Shown wherever people see this role.</Field.Description>
				{/if}
			</Field.Field>
			<Field.Field class="max-w-sm">
				<Field.Label for="role-description-{role.id}">Description</Field.Label>
				<Input
					id="role-description-{role.id}"
					value={description}
					oninput={(event) => edit({ description: event.currentTarget.value })}
					disabled={!!role.lock}
					maxlength={200}
					autocomplete="off"
				/>
			</Field.Field>
			{#if !role.lock}
				<div>
					<Button variant="destructive" size="sm" onclick={ondelete}>Delete role</Button>
				</div>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="permissions" class="pt-2 pb-2">
			{#each sections as section, index (section.group)}
				{@const headingId = `section-${role.id}-${section.group}`}
				<section aria-labelledby={headingId} class={['px-2 pt-3', index > 0 && 'mt-1 border-t']}>
					<div class="flex items-baseline justify-between gap-3 px-3 pb-1">
						<h3 id={headingId} class="text-sm font-semibold">{section.group}</h3>
						<p class="text-xs text-muted-foreground">
							{section.items.filter((p) => isOn(p)).length} of {section.items.length} on
						</p>
					</div>
					<p class="px-3 pb-1 text-xs text-muted-foreground">
						{section.group === 'Server'
							? 'Applies on the server a role is given on, or on every server when given panel-wide.'
							: 'Only applies when the role is given panel-wide.'}
					</p>
					<ul class="flex flex-col">
						{#each section.items as permission (permission)}
							{@const info = registry[permission]}
							{@const source = includedBy[permission]}
							{@const ownerOnly = info.ownerOnlyGrant && !isOwner}
							{@const id = `permission-${role.id}-${permission}`}
							<li>
								<Field.Field
									orientation="horizontal"
									class="items-start gap-4 rounded-lg px-3 py-3"
								>
									<Switch
										{id}
										class="mt-0.5"
										checked={isOn(permission)}
										disabled={!!role.lock || !!source || ownerOnly}
										onCheckedChange={(checked) => toggle(permission, checked)}
										aria-describedby="{id}-description"
									/>
									<Field.Content>
										<Field.Label for={id} class="text-sm font-semibold">{info.label}</Field.Label>
										<Field.Description id="{id}-description" class="text-xs/relaxed">
											{info.description}
											{#if source}
												<span class="block text-foreground/80">Included with {source}.</span>
											{:else if ownerOnly}
												<span class="block text-foreground/80">Only the owner can grant this.</span>
											{/if}
										</Field.Description>
									</Field.Content>
								</Field.Field>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</Tabs.Content>
	</Tabs.Root>
</section>
