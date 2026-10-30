<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { listInstances } from '#lib/instances.remote.js';
	import { allRoles } from '#lib/roles.remote.js';
	import { setUserAccess, userAccess } from '#lib/users.remote.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	let {
		user,
		open = $bindable(false)
	}: { user: { id: number; username: string } | null; open: boolean } = $props();

	const servers = listInstances();
	const roles = allRoles();
	const access = $derived(user ? userAccess(user.id) : null);
	const rolesOn = (instanceId: number | null) =>
		(access?.current ?? []).filter((a) => a.instanceId === instanceId).map((a) => a.roleId);

	async function give(instanceId: number | null, next: number[]) {
		if (!user) return;
		try {
			await setUserAccess({ userId: user.id, instanceId, roleIds: next });
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Could not save');
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full gap-0 sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Roles for {user?.username}</Sheet.Title>
			<Sheet.Description>
				Roles given to all servers apply everywhere, and panel permissions only come from there. A
				user can hold several; what they grant adds up and a deny wins. Changes save as you choose.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-1 scrollbar-subtle flex-col gap-3 overflow-y-auto p-4">
			{@render target('All servers and the panel', null)}
			{#each servers.current ?? [] as server (server.id)}
				{@render target(server.name, server.id)}
			{/each}
		</div>
	</Sheet.Content>
</Sheet.Root>

{#snippet target(title: string, instanceId: number | null)}
	<section class="flex flex-col gap-2 rounded-lg border p-3">
		<h3 class="truncate text-sm font-medium">{title}</h3>
		<ToggleGroup.Root
			type="multiple"
			variant="outline"
			size="sm"
			class="flex-wrap"
			value={rolesOn(instanceId).map(String)}
			aria-label="Roles on {title}"
			onValueChange={(next) => give(instanceId, next.map(Number))}
		>
			{#each roles.current ?? [] as role (role.id)}
				<ToggleGroup.Item
					value={String(role.id)}
					disabled={!role.assignable && !rolesOn(instanceId).includes(role.id)}
					class="data-[state=on]:bg-primary/15"
				>
					{role.name}
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
		{#if !rolesOn(instanceId).length}
			<p class="text-xs text-muted-foreground">
				{instanceId === null ? 'No roles on all servers.' : 'No role on this server.'}
			</p>
		{/if}
	</section>
{/snippet}
