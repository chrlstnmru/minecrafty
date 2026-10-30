<script lang="ts">
	import KeyIcon from '@tabler/icons-svelte/icons/key';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import ShieldIcon from '@tabler/icons-svelte/icons/shield-lock';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/page-header.svelte';
	import * as Form from '#lib/components/form/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { addUserSchema } from '#lib/schemas/users.js';
	import {
		addAccount,
		allUsers,
		deleteAccount,
		setUserPassword,
		setUserRole
	} from '#lib/users.remote.js';
	import type { PageProps } from './$types';
	import AccessSheet from './access-sheet.svelte';
	import RolesPanel from './roles-panel.svelte';

	type Row = { id: number; username: string; role: 'admin' | 'user'; instances: number };

	let { data }: PageProps = $props();
	const users = allUsers();
	const { username, role } = addAccount.fields;

	let tab = $state('users');
	let adding = $state(false);
	// new accounts are plain users unless the admin picks otherwise
	$effect(() => {
		if (adding && !role.value()) role.set('user');
	});
	let accessFor = $state<Row | null>(null);
	let accessOpen = $state(false);
	let passwordFor = $state<Row | null>(null);
	let password = $state('');
	let removing = $state<Row | null>(null);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	async function changeRole(row: Row) {
		try {
			await setUserRole({ id: row.id, role: row.role === 'admin' ? 'user' : 'admin' });
		} catch (e) {
			toast.error(message(e, 'Could not change the role'));
		}
	}

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

	async function remove() {
		if (!removing) return;
		try {
			await deleteAccount(removing.id);
			toast.success(`Deleted ${removing.username}`);
		} catch (e) {
			toast.error(message(e, 'Could not delete the user'));
		}
	}
</script>

<svelte:head><title>Users · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader
		title="Users"
		description="Admins manage everything. Other users get a role on each server you give them."
	></PageHeader>

	<Tabs.Root bind:value={tab}>
		<Tabs.List>
			<Tabs.Trigger value="users">Users</Tabs.Trigger>
			<Tabs.Trigger value="roles">Roles</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>

	{#if tab === 'roles'}
		<RolesPanel />
	{:else}
		<div class="flex justify-end">
			<Button onclick={() => (adding = true)}><PlusIcon />Add user</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Username</Table.Head>
					<Table.Head>Role</Table.Head>
					<Table.Head>Servers</Table.Head>
					<Table.Head class="w-px"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each users.current ?? [] as row (row.id)}
					{@const self = row.id === data.user.id}
					<Table.Row>
						<Table.Cell class="font-medium">
							{row.username}
							{#if self}<span class="text-xs text-muted-foreground">(you)</span>{/if}
						</Table.Cell>
						<Table.Cell>
							<Badge variant={row.role === 'admin' ? 'default' : 'secondary'}>{row.role}</Badge>
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">
							{row.role === 'admin' ? 'All' : row.instances}
						</Table.Cell>
						<Table.Cell>
							<div class="flex justify-end gap-1">
								{#if row.role !== 'admin'}
									{@render tip('Choose servers and permissions', ShieldIcon, 'Edit access', () => {
										accessFor = row;
										accessOpen = true;
									})}
								{/if}
								{@render tip('Set a new password', KeyIcon, 'Set password', () => {
									password = '';
									passwordFor = row;
								})}
								{#if !self}
									<Button variant="ghost" size="sm" onclick={() => changeRole(row)}>
										{row.role === 'admin' ? 'Make user' : 'Make admin'}
									</Button>
									{@render tip('Delete the account', TrashIcon, 'Delete user', () => {
										removing = row;
									})}
								{/if}
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

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

<Dialog.Root bind:open={adding}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add user</Dialog.Title>
			<Dialog.Description>
				They sign in with this username and password. Give them servers afterwards.
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
					<Form.Select
						label="Role"
						field={role}
						options={[
							{ value: 'user', label: 'User (only the servers they are given)' },
							{ value: 'admin', label: 'Admin (everything)' }
						]}
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

<AlertDialog.Root open={!!removing} onOpenChange={(o) => !o && (removing = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {removing?.username}?</AlertDialog.Title>
			<AlertDialog.Description>
				The account and its access are removed. The servers are not touched.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AccessSheet user={accessFor} bind:open={accessOpen} />
