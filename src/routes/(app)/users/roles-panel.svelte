<script lang="ts">
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
	import LockIcon from '@tabler/icons-svelte/icons/lock';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import { toast } from 'svelte-sonner';
	import { grantedBy } from '#lib/permissions.js';
	import { allRoles, removeRole } from '#lib/roles.remote.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import RoleSheet from './role-sheet.svelte';

	const roles = allRoles();
	type Role = NonNullable<typeof roles.current>[number];

	let editing = $state<{
		id?: number;
		name: string;
		description: string;
		rules: Role['rules'];
	} | null>(null);
	let open = $state(false);
	let removing = $state<Role | null>(null);

	const edit = (role: Role) => {
		editing = { id: role.id, name: role.name, description: role.description, rules: role.rules };
		open = true;
	};
	const duplicate = (role: Role) => {
		editing = { name: `${role.name} copy`, description: role.description, rules: role.rules };
		open = true;
	};
	const create = () => {
		editing = null;
		open = true;
	};

	async function remove() {
		if (!removing) return;
		try {
			await removeRole(removing.id);
			toast.success(`Deleted ${removing.name}`);
		} catch (e) {
			toast.error(
				(e as { body?: { message?: string } }).body?.message ?? 'Could not delete the role'
			);
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">
			Give a user one role per server. Built-in roles can be duplicated, not edited.
		</p>
		<Button onclick={create}><PlusIcon />New role</Button>
	</div>
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Role</Table.Head>
				<Table.Head>Allows</Table.Head>
				<Table.Head>Locks</Table.Head>
				<Table.Head>In use</Table.Head>
				<Table.Head class="w-px"><span class="sr-only">Actions</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each roles.current ?? [] as role (role.id)}
				{@const locks = role.rules.lockedProperties.length + role.rules.lockedSettings.length}
				<Table.Row>
					<Table.Cell>
						<div class="flex items-center gap-2 font-medium">
							{role.name}
							{#if role.builtIn}<Badge variant="secondary">built-in</Badge>{/if}
						</div>
						{#if role.description}
							<div class="text-xs text-muted-foreground">{role.description}</div>
						{/if}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">
						{grantedBy(role.rules).length} permissions
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">
						{#if locks}<LockIcon class="me-1 inline size-3.5" />{locks}{:else}–{/if}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{role.used}</Table.Cell>
					<Table.Cell>
						<div class="flex justify-end gap-1">
							{#if !role.builtIn}
								{@render tip('Edit', PencilIcon, () => edit(role))}
							{/if}
							{@render tip('Duplicate', CopyIcon, () => duplicate(role))}
							{#if !role.builtIn}
								{@render tip('Delete', TrashIcon, () => (removing = role))}
							{/if}
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

{#snippet tip(label: string, Icon: typeof PencilIcon, run: () => void)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon" aria-label={label} onclick={run}>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{label}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<RoleSheet role={editing} bind:open />

<AlertDialog.Root open={!!removing} onOpenChange={(o) => !o && (removing = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {removing?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				A role that is in use cannot be deleted; take it off those servers first.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
