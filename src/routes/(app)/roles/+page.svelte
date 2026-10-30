<script lang="ts">
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeftIcon from '@tabler/icons-svelte/icons/chevron-left';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import { isHttpError } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import * as Form from '#lib/components/form/index.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { newRoleSchema } from '#lib/schemas/roles.js';
	import { addRole, getRoleAccess, listRoles, removeRole, saveRoles } from '#lib/roles.remote.js';
	import type { RoleDraft } from './role-details.svelte';
	import RoleDetails from './role-details.svelte';
	import RoleList from './role-list.svelte';
	import SaveBar from './save-bar.svelte';

	// One await for both, so they load in parallel instead of one after another.
	const [roles, access] = $derived(await Promise.all([listRoles(), getRoleAccess()]));

	// Matches Tailwind's `lg`. Below it, the list and the details are two screens.
	const wide = new MediaQuery('(min-width: 64rem)', true);

	// Start on the top role by id, not "whatever is first", so saving or reordering doesn't move
	// the selection to a different role.
	let selectedId = $state<number | undefined>(untrack(() => roles[0]?.id));
	const selected = $derived(roles.find((r) => r.id === selectedId) ?? roles[0]);
	const detailOpen = $derived(!!page.state.roleDetail);

	function openRole(id: number | undefined) {
		selectedId = id;
		// A history entry, so the phone's back button returns to the list.
		if (id && !wide.current && !detailOpen) pushState('', { roleDetail: true });
	}

	/** Unsaved edits, per role, kept while you look at other roles. */
	let drafts = $state<Record<number, RoleDraft | undefined>>({});
	/** Unsaved order after a drag (every role id, highest first). */
	let pendingOrder = $state<number[]>();

	const draftEntries = $derived(
		Object.entries(drafts)
			.map(([id, d]) => [Number(id), d] as const)
			.filter((entry): entry is [number, RoleDraft] => !!entry[1])
	);
	const unsavedIds = $derived(new Set(draftEntries.map(([id]) => id)));
	const showHint = $derived(access.canWrite && roles.length > 1);

	/** The list as it will be after saving: the dragged order, with edited names. */
	const shownRoles = $derived.by(() => {
		// Roles added since the drag (say, by someone else) go at the end until it's saved.
		const ordered = pendingOrder
			? [
					...pendingOrder.flatMap((id) => roles.find((r) => r.id === id) ?? []),
					...roles.filter((r) => !pendingOrder!.includes(r.id))
				]
			: roles;
		return ordered.map((r) => {
			const name = drafts[r.id]?.name.trim();
			return name ? { ...r, name } : r;
		});
	});

	const orderChanged = $derived(
		!!pendingOrder && pendingOrder.some((id, index) => roles[index]?.id !== id)
	);

	const changeCount = $derived.by(() => {
		let count = orderChanged ? 1 : 0;
		for (const [id, d] of draftEntries) {
			const saved = roles.find((r) => r.id === id);
			if (!saved) continue;
			const before = new Set<string>(saved.permissions);
			const after = new Set(d.permissions);
			count +=
				[...after].filter((k) => !before.has(k)).length +
				[...before].filter((k) => !after.has(k)).length +
				(d.name !== saved.name ? 1 : 0) +
				(d.description !== saved.description ? 1 : 0);
		}
		return count;
	});

	/** The role to name in the save bar, when every change is to that one role. */
	const onlyRole = $derived(
		!orderChanged && draftEntries.length === 1
			? roles.find((r) => r.id === draftEntries[0]![0])?.name
			: undefined
	);

	let saveError = $state<string>();
	let saving = $state(false);

	type Edit = Parameters<typeof saveRoles>[0]['roles'][number];

	async function save() {
		const order = orderChanged ? pendingOrder : undefined;
		const edits: Edit[] = draftEntries.map(([roleId, d]) => ({
			roleId,
			name: d.name.trim(),
			description: d.description,
			permissions: d.permissions as Edit['permissions']
		}));
		const message = onlyRole ? `Changes saved to ${onlyRole}` : 'Changes saved';

		const keptDrafts = drafts;
		const keptOrder = pendingOrder;
		drafts = {};
		pendingOrder = undefined;
		saveError = undefined;
		saving = true;
		try {
			await saveRoles({ order, roles: edits });
			toast.success(message);
		} catch (err) {
			// Bring the edits back so nothing is lost, keeping anything changed while it saved.
			drafts = { ...keptDrafts, ...drafts };
			pendingOrder ??= keptOrder;
			saveError = isHttpError(err) ? err.body.message : 'Changes were not saved. Try again.';
		} finally {
			saving = false;
		}
	}

	function discard() {
		drafts = {};
		pendingOrder = undefined;
		saveError = undefined;
	}

	function handleReorder(order: number[]) {
		// Kept until "Save changes", like role edits.
		pendingOrder = order.every((id, index) => roles[index]?.id === id) ? undefined : order;
	}

	let createOpen = $state(false);

	function openCreate() {
		addRole.fields.set({ name: '' });
		createOpen = true;
	}

	let removing = $state(false);

	async function remove() {
		if (!selected) return;
		try {
			await removeRole(selected.id);
			toast.success(`Deleted ${selected.name}`);
			selectedId = undefined;
			if (detailOpen) history.back();
		} catch (err) {
			toast.error(isHttpError(err) ? err.body.message : 'Could not delete the role');
		}
	}

	const slide = (x: string) => ({
		x,
		opacity: 1,
		duration: prefersReducedMotion.current ? 0 : 260,
		easing: cubicOut
	});
</script>

<svelte:head><title>Roles · Minecrafty</title></svelte:head>

{#snippet listPane(flush: boolean)}
	<div class={['flex flex-col', !flush && 'gap-2']}>
		<RoleList
			class={flush ? 'rounded-none border-0' : undefined}
			roles={shownRoles}
			bind:selectedId={() => selected?.id, openRole}
			{unsavedIds}
			canWrite={access.canWrite}
			onreorder={handleReorder}
			oncreate={openCreate}
		/>
		{#if showHint}
			<p class={['text-xs/relaxed text-muted-foreground', flush ? 'px-4 pb-4' : 'px-1']}>
				Drag roles to rank them. A higher role can manage the roles below it.
			</p>
		{/if}
	</div>
{/snippet}

{#snippet detailPane(flush: boolean)}
	{#if selected}
		<RoleDetails
			class={flush ? 'rounded-none border-0 [&>header]:pt-1' : undefined}
			role={selected}
			bind:draft={drafts[selected.id]}
			isOwner={access.isOwner}
			ondelete={() => (removing = true)}
		/>
	{:else}
		<Empty.Root class="border bg-card p-8">
			<Empty.Header>
				<Empty.Title>No roles yet</Empty.Title>
				<Empty.Description>Create a role, then choose what people with it can do.</Empty.Description
				>
			</Empty.Header>
			{#if access.canWrite}
				<Empty.Content>
					<Button size="sm" onclick={openCreate}>
						<PlusIcon data-icon="inline-start" />
						New role
					</Button>
				</Empty.Content>
			{/if}
		</Empty.Root>
	{/if}
{/snippet}

<div class="flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
	<PageHeader
		title="Roles"
		description="What each role grants and how roles rank. Give roles to people on the Users page."
	/>

	{#if wide.current}
		<div class="grid grid-cols-[17rem_1fr] items-start gap-6">
			<div class="sticky top-0">{@render listPane(false)}</div>
			{@render detailPane(false)}
		</div>
	{:else}
		<!-- One card stays put; the list and the details slide inside it, sharing a grid cell so
		     they overlap mid-slide. -->
		<div class="grid overflow-hidden rounded-xl border bg-card">
			{#if detailOpen && selected}
				<div
					class="z-10 col-start-1 row-start-1 flex min-w-0 flex-col bg-card"
					transition:fly={slide('100%')}
				>
					<div class="px-3 pt-3">
						<Button variant="ghost" size="sm" onclick={() => history.back()}>
							<ChevronLeftIcon data-icon="inline-start" />
							Roles
						</Button>
					</div>
					{@render detailPane(true)}
				</div>
			{:else}
				<div class="col-start-1 row-start-1 min-w-0 bg-card" transition:fly={slide('-30%')}>
					{@render listPane(true)}
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if changeCount > 0 || saveError}
	<SaveBar
		roleName={onlyRole}
		{changeCount}
		error={saveError}
		{saving}
		canSave={changeCount > 0 && draftEntries.every(([, d]) => !!d.name.trim())}
		onsave={save}
		ondiscard={discard}
	/>
{/if}

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Form.Root
			schema={newRoleSchema}
			remoteFunction={addRole}
			class="flex flex-col gap-4"
			onSubmitted={(succeeded) => {
				if (!succeeded || !addRole.result) return;
				createOpen = false;
				openRole(addRole.result.id);
			}}
		>
			{#snippet children({ pending })}
				<Dialog.Header>
					<Dialog.Title>New role</Dialog.Title>
					<Dialog.Description
						>It starts at the bottom of the list with no permissions.</Dialog.Description
					>
				</Dialog.Header>
				<Form.Input
					field={addRole.fields.name}
					label="Name"
					placeholder="Moderator"
					autocomplete="off"
				/>
				<Dialog.Footer>
					<Button variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button>
					<Button type="submit" loading={pending > 0}>Create role</Button>
				</Dialog.Footer>
			{/snippet}
		</Form.Root>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={removing}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {selected?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				{selected?.memberCount
					? `${selected.memberCount} ${selected.memberCount === 1 ? 'person loses' : 'people lose'} what it grants.`
					: 'Nobody has this role.'}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
