<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { listInstances } from '#lib/instances.remote.js';
	import { grantedBy } from '#lib/permissions.js';
	import { allRoles } from '#lib/roles.remote.js';
	import { setUserAccess, userAccess } from '#lib/users.remote.js';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import * as Sheet from '#lib/components/ui/sheet/index.js';

	let {
		user,
		open = $bindable(false)
	}: { user: { id: number; username: string } | null; open: boolean } = $props();

	const servers = listInstances();
	const roles = allRoles();
	const access = $derived(user ? userAccess(user.id) : null);
	const roleOn = (instanceId: number) =>
		access?.current?.find((a) => a.instanceId === instanceId)?.roleId;

	const options = $derived([
		{ value: '', label: 'No access' },
		...(roles.current ?? []).map((r) => ({ value: String(r.id), label: r.name }))
	]);

	async function give(instanceId: number, value: string) {
		if (!user) return;
		try {
			await setUserAccess({ userId: user.id, instanceId, roleId: value ? Number(value) : null });
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Could not save');
		}
	}

	const summary = (instanceId: number) => {
		const role = roles.current?.find((r) => r.id === roleOn(instanceId));
		if (!role) return 'Cannot see this server.';
		const locks = role.rules.lockedProperties.length + role.rules.lockedSettings.length;
		return `${grantedBy(role.rules).length} permissions${locks ? `, ${locks} locked` : ''}`;
	};
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full gap-0 sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Access for {user?.username}</Sheet.Title>
			<Sheet.Description>
				Pick a role for each server. Changes save as you choose. Roles are made in the Roles tab.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-1 scrollbar-subtle flex-col gap-3 overflow-y-auto p-4">
			{#each servers.current ?? [] as server (server.id)}
				<section class="flex flex-col gap-2 rounded-lg border p-3">
					<h3 class="truncate text-sm font-medium">{server.name}</h3>
					<SelectMenu
						{options}
						value={String(roleOn(server.id) ?? '')}
						aria-label="Role on {server.name}"
						onValueChange={(next) => give(server.id, next)}
					/>
					<p class="text-xs text-muted-foreground">{summary(server.id)}</p>
				</section>
			{:else}
				<p class="text-sm text-muted-foreground">There are no servers yet.</p>
			{/each}
		</div>
	</Sheet.Content>
</Sheet.Root>
