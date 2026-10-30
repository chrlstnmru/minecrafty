<script lang="ts">
	import KeyIcon from '@tabler/icons-svelte/icons/key';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import ShieldIcon from '@tabler/icons-svelte/icons/shield-lock';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import { toast } from 'svelte-sonner';
	import * as DataTable from '#lib/components/data-table/index.js';
	import {
		createColumns,
		createDataTable,
		dateCell,
		renderSnippet,
		selectColumn
	} from '#lib/components/data-table/index.js';
	import * as Form from '#lib/components/form/index.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { listInstances } from '#lib/instances.remote.js';
	import { listRoles } from '#lib/roles.remote.js';
	import { addUserSchema } from '#lib/schemas/users.js';
	import {
		addAccount,
		allUsers,
		deleteAccounts,
		grantRoleToUsers,
		setUserPassword
	} from '#lib/users.remote.js';
	import type { PageProps } from './$types';
	import AccessSheet from './access-sheet.svelte';

	type Row = {
		id: number;
		username: string;
		role: 'owner' | 'user';
		createdAt: Date;
		assignments: number;
		canManage: boolean;
		canAssign: boolean;
	};

	let { data }: PageProps = $props();
	const users = allUsers();
	const servers = listInstances();
	const roles = listRoles();
	const canAddUsers = $derived(data.panel.includes('users.write'));
	const canGrant = $derived(data.panel.includes('roles.assign'));
	const { username } = addAccount.fields;

	let adding = $state(false);
	let accessFor = $state<Row | null>(null);
	let accessOpen = $state(false);
	let passwordFor = $state<Row | null>(null);
	let password = $state('');
	/** accounts waiting for a delete confirmation */
	let removing = $state<Row[] | null>(null);
	let granting = $state<Row[] | null>(null);
	let grantRole = $state('');
	let grantTarget = $state('');

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	const col = createColumns<Row>();
	const columns = col.columns([
		selectColumn<Row>((u) => u.username),
		col.accessor('username', {
			header: 'User',
			cell: ({ row }) => renderSnippet(userCell, row.original),
			meta: { stack: 'title' }
		}),
		// the owner has no roles to count: sorted as the most
		col.accessor((u) => (u.role === 'owner' ? Infinity : u.assignments), {
			id: 'roles',
			header: 'Roles',
			cell: ({ row }) => renderSnippet(rolesCell, row.original),
			meta: { stack: 'subtitle' }
		}),
		col.accessor('createdAt', {
			header: 'Created',
			cell: dateCell({ time: true }),
			sortFn: 'datetime',
			meta: { stack: 'subtitle' }
		}),
		col.display({
			id: 'actions',
			header: () => renderSnippet(srOnly, 'Actions'),
			cell: ({ row }) => renderSnippet(actionsCell, row.original),
			meta: { stack: 'end', align: 'end', class: 'w-px' }
		})
	]);

	// newest first, until a column is clicked
	const table = createDataTable({
		columns,
		url: true,
		get data(): Row[] {
			return users.current ?? [];
		},
		getRowId: (u) => String(u.id),
		// the owner and yourself cannot be picked; neither can anyone you may do nothing to
		enableRowSelection: (row) =>
			row.original.id !== data.user.id &&
			row.original.role !== 'owner' &&
			(row.original.canManage || row.original.canAssign),
		initialState: { sorting: [{ id: 'createdAt', desc: true }] }
	});

	async function savePassword() {
		if (!passwordFor) return;
		try {
			await setUserPassword({ id: passwordFor.id, password });
			toast.success(`Password changed for ${passwordFor.username}`);
			passwordFor = null;
		} catch (e) {
			toast.error(message(e, 'Could not change the password'));
		}
	}

	const who = (list: Row[]) => (list.length === 1 ? list[0].username : `${list.length} users`);

	async function remove() {
		if (!removing) return;
		const list = removing;
		removing = null;
		try {
			const result = await deleteAccounts(list.map((u) => u.id));
			table.resetRowSelection(true);
			if (result.deleted)
				toast.success(`Deleted ${result.deleted === 1 ? 'one user' : `${result.deleted} users`}`);
			if (result.skipped.length)
				toast.error(`Skipped ${result.skipped.length}: ${result.skipped[0].reason}`);
		} catch (e) {
			toast.error(message(e, 'Could not delete the users'));
		}
	}

	const roleOptions = $derived(
		(roles.current ?? [])
			.filter((r) => r.assignable)
			.map((r) => ({ value: String(r.id), label: r.name }))
	);
	const targetOptions = $derived([
		{ value: 'panel', label: 'All servers and the panel' },
		...(servers.current ?? []).map((s) => ({ value: String(s.id), label: s.name }))
	]);

	async function grant() {
		if (!granting || !grantRole) return;
		const list = granting;
		granting = null;
		try {
			const result = await grantRoleToUsers({
				userIds: list.map((u) => u.id),
				roleId: Number(grantRole),
				instanceId: grantTarget === 'panel' ? null : Number(grantTarget)
			});
			table.resetRowSelection(true);
			if (result.granted)
				toast.success(
					`Gave the role to ${result.granted === 1 ? 'one user' : `${result.granted} users`}`
				);
			if (result.skipped.length)
				toast.error(`Skipped ${result.skipped.length}: ${result.skipped[0].reason}`);
		} catch (e) {
			toast.error(message(e, 'Could not give the role'));
		}
	}

	function openGrant(list: Row[]) {
		grantRole = '';
		grantTarget = 'panel';
		granting = list;
	}
</script>

<svelte:head><title>Users · Minecrafty</title></svelte:head>

{#snippet srOnly(label: string)}
	<span class="sr-only">{label}</span>
{/snippet}

{#snippet userCell(u: Row)}
	<span class="font-medium">
		{u.username}
		{#if u.id === data.user.id}<span class="text-xs font-normal text-muted-foreground">(you)</span
			>{/if}
		{#if u.role === 'owner'}<Badge class="ms-2">Owner</Badge>{/if}
	</span>
{/snippet}

{#snippet rolesCell(u: Row)}
	<span class="text-muted-foreground">
		{u.role === 'owner'
			? 'Everything'
			: u.assignments
				? `${u.assignments} ${u.assignments === 1 ? 'role' : 'roles'}`
				: 'No roles'}
	</span>
{/snippet}

{#snippet actionsCell(u: Row)}
	<div class="flex justify-end gap-1">
		{#if u.role !== 'owner' && u.canAssign}
			{@render tip('Give roles, panel-wide or per server', ShieldIcon, 'Edit access', () => {
				accessFor = u;
				accessOpen = true;
			})}
		{/if}
		{#if u.canManage || u.id === data.user.id}
			{@render tip('Set a new password', KeyIcon, 'Set password', () => {
				password = '';
				passwordFor = u;
			})}
		{/if}
		{#if u.id !== data.user.id && u.canManage}
			{@render tip('Delete the account', TrashIcon, 'Delete user', () => {
				removing = [u];
			})}
		{/if}
	</div>
{/snippet}

{#snippet tip(text: string, Icon: typeof KeyIcon, label: string, run: () => void)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon" aria-label={label} onclick={run}>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{text}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader
		title="Users"
		description="The owner can do everything. Everyone else can only do what their roles allow, panel-wide or on a server."
	>
		{#snippet actions()}
			{#if canAddUsers}
				<Button onclick={() => (adding = true)}><PlusIcon />Add user</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<DataTable.Root {table}>
		<DataTable.Toolbar>
			<DataTable.Search placeholder="Search users" />
		</DataTable.Toolbar>

		<DataTable.Content {table} loading={!users.current}>
			{#snippet empty()}
				<Empty.Root class="p-8">
					<Empty.Header>
						<Empty.Title>No users yet</Empty.Title>
					</Empty.Header>
				</Empty.Root>
			{/snippet}
		</DataTable.Content>

		<DataTable.Pagination noun={['user', 'users']} />

		<DataTable.SelectionBar {table}>
			{#snippet children({ rows })}
				{@const picked = rows.map((r) => r.original)}
				{#if canGrant && picked.every((u) => u.canAssign)}
					<Button size="sm" variant="outline" onclick={() => openGrant(picked)}>Give role</Button>
				{/if}
				{#if picked.every((u) => u.canManage)}
					<Button size="sm" variant="destructive" onclick={() => (removing = picked)}>
						Delete
					</Button>
				{/if}
			{/snippet}
		</DataTable.SelectionBar>
	</DataTable.Root>
</div>

<Dialog.Root bind:open={adding}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add user</Dialog.Title>
			<Dialog.Description>
				They sign in with this username and password, and can do nothing until you give them a role.
			</Dialog.Description>
		</Dialog.Header>
		<Form.Root
			schema={addUserSchema}
			remoteFunction={addAccount}
			onSubmitted={(succeeded) => {
				if (!succeeded) return;
				toast.success('User added');
				adding = false;
			}}
		>
			{#snippet children({ pending })}
				<Field.Group>
					<Form.Input label="Username" field={username} autocomplete="off" />
					<Form.Input
						label="Password"
						type="password"
						field={addAccount.fields._password}
						autocomplete="new-password"
						description="At least 8 characters."
					/>
					<Form.Errors form={addAccount} />
					<div><Button type="submit" loading={pending > 0}>Add user</Button></div>
				</Field.Group>
			{/snippet}
		</Form.Root>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!passwordFor} onOpenChange={(o) => !o && (passwordFor = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New password for {passwordFor?.username}</Dialog.Title>
			<Dialog.Description>
				They are signed out everywhere and must sign in with the new password.
			</Dialog.Description>
		</Dialog.Header>
		<Input
			type="password"
			bind:value={password}
			autocomplete="new-password"
			placeholder="At least 8 characters"
			aria-label="New password"
		/>
		<Dialog.Footer>
			<Button disabled={password.length < 8} onclick={savePassword}>Change password</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!granting} onOpenChange={(o) => !o && (granting = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Give a role to {granting ? who(granting) : ''}</Dialog.Title>
			<Dialog.Description>
				It is added to the roles they already have there. Roles ranked at or above yours are not
				listed.
			</Dialog.Description>
		</Dialog.Header>
		<Field.Group>
			<Field.Field>
				<Field.Label for="grant-role">Role</Field.Label>
				<SelectMenu
					id="grant-role"
					options={roleOptions}
					bind:value={grantRole}
					placeholder="Choose a role"
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="grant-target">On</Field.Label>
				<SelectMenu id="grant-target" options={targetOptions} bind:value={grantTarget} />
			</Field.Field>
		</Field.Group>
		<Dialog.Footer>
			<Button disabled={!grantRole} onclick={grant}>Give role</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={!!removing} onOpenChange={(o) => !o && (removing = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {removing ? who(removing) : ''}?</AlertDialog.Title>
			<AlertDialog.Description>
				The {removing && removing.length > 1
					? 'accounts and their roles are'
					: 'account and its roles are'}
				removed. The servers are not touched.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AccessSheet user={accessFor} bind:open={accessOpen} />
