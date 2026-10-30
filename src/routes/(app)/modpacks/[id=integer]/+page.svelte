<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@tabler/icons-svelte/icons/arrow-left';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import ServerIcon from '@tabler/icons-svelte/icons/server';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import { toast } from 'svelte-sonner';
	import {
		addPackMod,
		applyPackVersionChange,
		deleteLocalPack,
		getLocalPack,
		packMinecraftVersions,
		previewPackVersionChange,
		removePackFile,
		removePackOverride,
		setPackFileVersion,
		updateLocalPack
	} from '#lib/builder.remote.js';
	import Combobox from '#lib/components/combobox.svelte';
	import LoaderBadge from '#lib/components/loader-badge.svelte';
	import MakeServerDialog from '#lib/components/make-server-dialog.svelte';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(Number(page.params.id));
	const pack = $derived(getLocalPack({ id }));
	const canWrite = $derived(data.panel.includes('modpacks.write'));
	const canMakeServer = $derived(data.panel.includes('instances.create'));

	let tab = $state('mods');
	let makingServer = $state(false);
	let deleting = $state(false);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	// ---- mods ----
	const inPack = $derived(
		new Set((pack.current?.files ?? []).flatMap((f) => (f.projectId ? [f.projectId] : [])))
	);

	let picker = $state<{
		projectId: string;
		title: string;
		fileId: number;
		versionId: string;
	} | null>(null);
	let pickerOpen = $state(false);

	async function add(projectId: string, title: string, versionId?: string) {
		try {
			const result = await addPackMod({ id, projectId, versionId });
			const extra = result.added.length - 1;
			toast.success(
				extra > 0
					? `Added ${title} and ${extra} required ${extra === 1 ? 'mod' : 'mods'}`
					: `Added ${title}`
			);
			if (result.skipped.length)
				toast.warning(`No compatible version of ${result.skipped.join(', ')}`);
		} catch (e) {
			toast.error(message(e, `Could not add ${title}`));
		}
	}

	async function remove(fileId: number, title: string) {
		try {
			await removePackFile({ id, fileId });
			toast.success(`Removed ${title}`);
		} catch (e) {
			toast.error(message(e, `Could not remove ${title}`));
		}
	}

	async function repin(versionId: string) {
		if (!picker) return;
		try {
			await setPackFileVersion({ id, fileId: picker.fileId, versionId });
			toast.success(`Changed ${picker.title}`);
		} catch (e) {
			toast.error(message(e, 'Could not change the version'));
		}
	}

	const sideLabel = (side: string | null) => (side === 'unsupported' ? 'no' : (side ?? '?'));

	// ---- config files ----
	let folder = $state('config');
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();

	async function uploadConfig(file: File | undefined) {
		if (!file) return;
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', file);
			body.set('path', folder);
			const res = await fetch(`/modpacks/${id}/overrides`, { method: 'POST', body });
			if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
			await pack.refresh();
			toast.success(`Added ${file.name}`);
		} catch (e) {
			toast.error(e instanceof Error && e.message ? e.message : 'Could not add the file');
		} finally {
			uploading = false;
			if (fileInput) fileInput.value = '';
		}
	}

	async function removeConfig(path: string) {
		try {
			await removePackOverride({ id, path });
		} catch (e) {
			toast.error(message(e, 'Could not remove the file'));
		}
	}

	const size = (bytes: number) =>
		bytes < 1024
			? `${bytes} B`
			: bytes < 1024 * 1024
				? `${(bytes / 1024).toFixed(1)} KB`
				: `${(bytes / 1024 / 1024).toFixed(1)} MB`;

	// ---- settings ----
	let name = $state('');
	let description = $state('');
	// load the saved values when the pack arrives or changes
	$effect(() => {
		const p = pack.current;
		if (!p) return;
		name = p.name;
		description = p.description;
	});
	const dirty = $derived(
		!!pack.current && (name !== pack.current.name || description !== pack.current.description)
	);

	async function saveSettings() {
		try {
			await updateLocalPack({ id, name, description });
			toast.success('Saved');
		} catch (e) {
			toast.error(message(e, 'Could not save'));
		}
	}

	let nextMc = $state('');
	const versions = $derived(pack.current ? packMinecraftVersions(pack.current.loader) : null);
	const mcOptions = $derived((versions?.current ?? []).map((v) => ({ value: v, label: v })));
	const change = $derived(
		nextMc && pack.current && nextMc !== pack.current.mcVersion
			? previewPackVersionChange({ id, mcVersion: nextMc })
			: null
	);
	let applying = $state(false);

	async function applyChange(dropIncompatible: boolean) {
		applying = true;
		try {
			const result = await applyPackVersionChange({ id, mcVersion: nextMc, dropIncompatible });
			toast.success(
				`Now on Minecraft ${nextMc}: ${result.updated} updated${result.removed ? `, ${result.removed} removed` : ''}`
			);
			nextMc = '';
		} catch (e) {
			toast.error(message(e, 'Could not change the version'));
		} finally {
			applying = false;
		}
	}

	async function removePack() {
		deleting = false;
		try {
			await deleteLocalPack({ id });
			toast.success('Pack deleted');
			await goto('/modpacks');
		} catch (e) {
			toast.error(message(e, 'Could not delete the pack'));
		}
	}
</script>

<svelte:head><title>{pack.current?.name ?? 'Modpack'} · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<div class="flex items-start gap-2">
		<Button
			variant="ghost"
			size="icon"
			href="/modpacks"
			aria-label="Back to modpacks"
			class="mt-0.5"
		>
			<ArrowLeftIcon />
		</Button>
		<div class="min-w-0 flex-1">
			<PageHeader
				title={pack.current?.name ?? ''}
				description={pack.current?.description || undefined}
			>
				{#snippet badge()}
					{#if pack.current}
						<LoaderBadge loader={pack.current.loader} version={pack.current.loaderVersion} />
						<Badge variant="muted">Minecraft {pack.current.mcVersion}</Badge>
						<Badge variant="muted">revision {pack.current.revision}</Badge>
					{/if}
				{/snippet}
				{#snippet actions()}
					<Button variant="outline" href="/modpacks/{id}/export" data-sveltekit-reload>
						<DownloadIcon />Download .mrpack
					</Button>
					{#if canMakeServer}
						<Button onclick={() => (makingServer = true)}><ServerIcon />Make a server</Button>
					{/if}
				{/snippet}
			</PageHeader>
		</div>
	</div>

	{#if pack.current}
		<Tabs.Root bind:value={tab}>
			<Tabs.List>
				<Tabs.Trigger value="mods">Mods ({pack.current.files.length})</Tabs.Trigger>
				<Tabs.Trigger value="configs">Configs ({pack.current.overrides.length})</Tabs.Trigger>
				{#if canWrite}<Tabs.Trigger value="settings">Settings</Tabs.Trigger>{/if}
			</Tabs.List>
		</Tabs.Root>

		{#if tab === 'mods'}
			<Card.Root>
				<Card.Content class="px-0">
					{#if pack.current.files.length}
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head class="ps-6">Mod</Table.Head>
									<Table.Head>Version</Table.Head>
									<Table.Head>Client</Table.Head>
									<Table.Head>Server</Table.Head>
									<Table.Head class="pe-6"><span class="sr-only">Actions</span></Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each pack.current.files as file (file.id)}
									<Table.Row>
										<Table.Cell class="ps-6">
											<div class="flex min-w-0 items-center gap-3">
												{#if file.iconUrl}
													<img
														src={file.iconUrl}
														alt=""
														class="size-8 shrink-0 rounded-md bg-muted"
													/>
												{:else}
													<div class="size-8 shrink-0 rounded-md bg-muted"></div>
												{/if}
												<div class="grid min-w-0">
													<span class="truncate text-sm font-medium">{file.title}</span>
													<span class="truncate text-xs text-muted-foreground">
														{file.dependencyOf
															? 'Needed by another mod'
															: file.projectId
																? file.path
																: `${file.path} · not from Modrinth`}
													</span>
												</div>
											</div>
										</Table.Cell>
										<Table.Cell>
											{#if file.projectId && canWrite}
												<Button
													variant="ghost"
													size="sm"
													onclick={() => {
														picker = {
															projectId: file.projectId!,
															title: file.title,
															fileId: file.id,
															versionId: file.versionId ?? ''
														};
														pickerOpen = true;
													}}
												>
													{file.versionNumber}
												</Button>
											{:else}
												<span class="text-sm text-muted-foreground"
													>{file.versionNumber ?? '–'}</span
												>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-muted-foreground"
											>{sideLabel(file.clientSide)}</Table.Cell
										>
										<Table.Cell class="text-muted-foreground"
											>{sideLabel(file.serverSide)}</Table.Cell
										>
										<Table.Cell class="pe-6 text-end">
											{#if canWrite}
												<Button
													variant="ghost"
													size="icon"
													aria-label="Remove {file.title}"
													onClickPromise={() => remove(file.id, file.title)}
												>
													<TrashIcon />
												</Button>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					{:else}
						<Empty.Root class="p-8">
							<Empty.Header>
								<Empty.Title>No mods yet</Empty.Title>
								<Empty.Description>
									{canWrite ? 'Search below and add the first one.' : 'This pack has no mods.'}
								</Empty.Description>
							</Empty.Header>
						</Empty.Root>
					{/if}
				</Card.Content>
			</Card.Root>

			{#if canWrite}
				<PackBrowser
					kind="pack"
					instanceId={id}
					noun="mod"
					description="Mods for {pack.current.loader} on Minecraft {pack.current
						.mcVersion}. Required dependencies come with them, each pinned to one version."
					actionLabel="Add"
					installedIds={inPack}
					onInstall={add}
				/>
			{/if}
		{:else if tab === 'configs'}
			<Card.Root>
				<Card.Header>
					<Card.Title>Config files</Card.Title>
					<Card.Description>
						Copied into every server made from this pack, and into the .mrpack under overrides/.
					</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-4">
					{#each pack.current.overrides as file (file.path)}
						<div class="flex items-center gap-3 border-b pb-2 last:border-b-0">
							<span class="min-w-0 flex-1 truncate font-mono text-sm">{file.path}</span>
							<span class="text-xs text-muted-foreground">{size(file.size)}</span>
							{#if canWrite}
								<Button
									variant="ghost"
									size="icon"
									aria-label="Remove {file.path}"
									onClickPromise={() => removeConfig(file.path)}
								>
									<TrashIcon />
								</Button>
							{/if}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No config files.</p>
					{/each}
					{#if canWrite}
						<div class="flex flex-wrap items-end gap-3">
							<Field.Field class="w-56">
								<Field.Label for="config-folder">Folder in the server</Field.Label>
								<Input
									id="config-folder"
									bind:value={folder}
									class="font-mono"
									autocomplete="off"
								/>
							</Field.Field>
							<input
								bind:this={fileInput}
								type="file"
								class="hidden"
								onchange={(e) => uploadConfig(e.currentTarget.files?.[0])}
							/>
							<Button variant="outline" loading={uploading} onclick={() => fileInput?.click()}>
								<UploadIcon />Add a file
							</Button>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else if tab === 'settings' && canWrite}
			<Card.Root>
				<Card.Header>
					<Card.Title>Details</Card.Title>
				</Card.Header>
				<Card.Content class="grid max-w-xl gap-4">
					<Field.Field>
						<Field.Label for="pack-name">Name</Field.Label>
						<Input id="pack-name" bind:value={name} maxlength={60} autocomplete="off" />
					</Field.Field>
					<Field.Field>
						<Field.Label for="pack-description">Description</Field.Label>
						<Input
							id="pack-description"
							bind:value={description}
							maxlength={500}
							autocomplete="off"
						/>
					</Field.Field>
					<div><Button disabled={!dirty || !name.trim()} onclick={saveSettings}>Save</Button></div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>Minecraft version</Card.Title>
					<Card.Description>
						Pick another version to see which mods carry over. It only changes once you apply it.
					</Card.Description>
				</Card.Header>
				<Card.Content class="grid max-w-xl gap-4">
					<Combobox
						options={mcOptions}
						bind:value={nextMc}
						placeholder="Currently {pack.current.mcVersion}"
					/>
					{#if change}
						{#if change.loading && !change.current}
							<p class="text-sm text-muted-foreground">Checking each mod…</p>
						{:else if change.error}
							<p class="text-sm text-destructive" role="alert">Could not check that version.</p>
						{:else if change.current}
							<div class="grid gap-2 text-sm">
								<p>
									{change.current.compatible.length} of {pack.current.files.length} mods have a version
									for
									{nextMc}.
								</p>
								{#if change.current.unchecked}
									<p class="text-muted-foreground">
										{change.current.unchecked} files are not from Modrinth and are left as they are.
									</p>
								{/if}
								{#if change.current.incompatible.length}
									<div class="grid gap-1 rounded-lg border border-warning/40 p-3">
										<p class="font-medium">No version for {nextMc}:</p>
										<ul class="list-inside list-disc text-muted-foreground">
											{#each change.current.incompatible as mod (mod.id)}<li>{mod.title}</li>{/each}
										</ul>
									</div>
								{/if}
							</div>
							<div class="flex flex-wrap gap-2">
								{#if change.current.incompatible.length}
									<Button
										variant="destructive"
										loading={applying}
										onclick={() => applyChange(true)}
									>
										Remove those and change
									</Button>
								{:else}
									<Button loading={applying} onclick={() => applyChange(false)}
										>Change to {nextMc}</Button
									>
								{/if}
								<Button variant="ghost" onclick={() => (nextMc = '')}>Cancel</Button>
							</div>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>Delete pack</Card.Title>
					<Card.Description
						>Removes the pack and its config files. Servers made from it are not touched.</Card.Description
					>
				</Card.Header>
				<Card.Footer>
					<Button variant="destructive" onclick={() => (deleting = true)}>Delete pack</Button>
				</Card.Footer>
			</Card.Root>
		{/if}
	{/if}
</div>

{#if picker}
	<ModVersionsSheet
		bind:open={pickerOpen}
		kind="pack"
		instanceId={id}
		projectId={picker.projectId}
		title={picker.title}
		noun="mod"
		currentVersionId={picker.versionId}
		onSelect={repin}
	/>
{/if}

{#if pack.current}
	<MakeServerDialog bind:open={makingServer} packId={id} packName={pack.current.name} />
{/if}

<AlertDialog.Root bind:open={deleting}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {pack.current?.name}?</AlertDialog.Title>
			<AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={removePack}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
