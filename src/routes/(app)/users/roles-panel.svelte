<script lang="ts">
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
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

	let { isAdmin, canWrite }: { isAdmin: boolean; canWrite: boolean } = $props();

	const roles = allRoles();
	type Role = NonNullable<typeof roles.current>[number];

	let editing = $state<{
		id?: number;
		name: string;
		description: string;
		rank: number;
		rules: Role['rules'];
	} | null>(null);
	let open = $state(false);
	let removing = $state<Role | null>(null);

	const edit = (role: Role) => {
		editing = {
			id: role.id,
			name: role.name,
			description: role.description,
			rank: role.rank,
			rules: role.rules
		};
		open = true;
	};
	const duplicate = (role: Role) => {
		editing = {
			name: `${role.name} copy`,
			description: role.description,
			rank: isAdmin ? role.rank : Math.max(0, role.rank - 1),
			rules: role.rules
		};
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
			A user can hold several roles, on the panel or on a server. Built-in roles can be duplicated,
			not edited.
		</p>
		{#if canWrite}<Button onclick={create}><PlusIcon />New role</Button>{/if}
	</div>
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Role</Table.Head>
				<Table.Head>Rank</Table.Head>
				<Table.Head>Grants</Table.Head>
				<Table.Head>In use</Table.Head>
				<Table.Head class="w-px"><span class="sr-only">Actions</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each roles.current ?? [] as role (role.id)}
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
					<Table.Cell class="text-muted-foreground tabular-nums">{role.rank}</Table.Cell>
					<Table.Cell class="text-muted-foreground">
						{grantedBy(role.rules).length} permissions
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{role.used}</Table.Cell>
					<Table.Cell>
						<div class="flex justify-end gap-1">
							{#if role.canEdit}
								{@render tip('Edit', PencilIcon, () => edit(role))}
							{/if}
							{#if canWrite}
								{@render tip('Duplicate', CopyIcon, () => duplicate(role))}
							{/if}
							{#if role.canDelete}
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

<RoleSheet role={editing} bind:open {isAdmin} />

<AlertDialog.Root open={!!removing} onOpenChange={(o) => !o && (removing = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {removing?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				{removing?.used
					? `${removing.used} ${removing.used === 1 ? 'assignment stops' : 'assignments stop'} granting anything.`
					: 'Nobody has this role.'}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
