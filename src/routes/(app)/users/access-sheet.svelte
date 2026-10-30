<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { listInstances } from '#lib/instances.remote.js';
	import {
		ACCESS_PRESETS,
		PERMISSIONS,
		PERMISSION_INFO,
		normalizePermissions,
		type Permission
	} from '#lib/permissions.js';
	import { setUserAccess, userAccess } from '#lib/users.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';

	let {
		user,
		open = $bindable(false)
	}: { user: { id: number; username: string } | null; open: boolean } = $props();

	const servers = listInstances();
	const access = $derived(user ? userAccess(user.id) : null);
	const grantedOn = (instanceId: number): Permission[] =>
		access?.current?.find((a) => a.instanceId === instanceId)?.permissions ?? [];

	async function save(instanceId: number, permissions: Permission[]) {
		if (!user) return;
		try {
			await setUserAccess({ userId: user.id, instanceId, permissions });
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Could not save');
		}
	}

	function toggle(instanceId: number, permission: Permission, on: boolean) {
		// view is implied by anything else, so it can only be taken off by clearing everything
		const others = grantedOn(instanceId).filter((p) => p !== permission);
		const next = on ? [...others, permission] : permission === 'view' ? [] : others;
		return save(instanceId, normalizePermissions(next));
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full gap-0 sm:max-w-xl">
		<Sheet.Header>
			<Sheet.Title>Access for {user?.username}</Sheet.Title>
			<Sheet.Description>
				Pick what this user may do on each server. Changes save as you tick them.
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-1 scrollbar-subtle flex-col gap-4 overflow-y-auto p-4">
			{#each servers.current ?? [] as server (server.id)}
				{@const granted = grantedOn(server.id)}
				<section class="flex flex-col gap-3 rounded-lg border p-3">
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="min-w-0 flex-1 truncate text-sm font-medium">{server.name}</h3>
						<div class="flex flex-wrap gap-1">
							<Button variant="ghost" size="xs" onclick={() => save(server.id, [])}>None</Button>
							{#each ACCESS_PRESETS as preset (preset.name)}
								<Button
									variant="outline"
									size="xs"
									onclick={() => save(server.id, preset.permissions)}
								>
									{preset.name}
								</Button>
							{/each}
						</div>
					</div>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each PERMISSIONS as permission (permission)}
							{@const checkId = `${server.id}-${permission}`}
							<div class="flex items-start gap-2">
								<Checkbox
									id={checkId}
									checked={granted.includes(permission)}
									disabled={permission === 'view' && granted.length > 1}
									onCheckedChange={(on) => toggle(server.id, permission, on === true)}
								/>
								<Label for={checkId} class="flex flex-col items-start gap-0.5">
									<span>{PERMISSION_INFO[permission].label}</span>
									<span class="text-xs font-normal text-muted-foreground">
										{PERMISSION_INFO[permission].description}
									</span>
								</Label>
							</div>
						{/each}
					</div>
				</section>
			{:else}
				<p class="text-sm text-muted-foreground">There are no servers yet.</p>
			{/each}
		</div>
	</Sheet.Content>
</Sheet.Root>
