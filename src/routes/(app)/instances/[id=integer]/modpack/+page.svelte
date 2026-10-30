<script lang="ts">
	import { page } from '$app/state';
	import PackageOffIcon from '@tabler/icons-svelte/icons/package-off';
	import { toast } from 'svelte-sonner';
	import { getInstance, listInstances } from '#lib/instances.remote.js';
	import { installedMods } from '#lib/mods.remote.js';
	import {
		modpackStatus,
		modpackUpdatePreview,
		updateModpack
	} from '#lib/modpack-update.remote.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Combobox from '#lib/components/combobox.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { formatBytes } from '#lib/format.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// awaited, so the server renders the page and the browser hydrates the same markup
	const data = $derived(await modpackStatus(id));
	const all = listInstances();
	const row = $derived(all.current?.find((i) => i.id === id));
	const installing = $derived(row?.installState === 'installing');
	const running = $derived(row?.state === 'running' || row?.state === 'stopping');

	const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	// versions come newest first, so everything before the installed one is newer
	const position = $derived(data.versions.findIndex((v) => v.id === data.pack?.versionId));
	const others = $derived(data.versions.filter((v) => v.id !== data.pack?.versionId));
	const newerReleases = $derived(
		data.versions.slice(0, Math.max(0, position)).filter((v) => v.versionType === 'release')
	);
	const options = $derived(
		data.versions
			.filter((v) => v.id !== data.pack?.versionId)
			.map((v) => ({
				value: v.id,
				label: `${v.versionNumber} · ${date.format(new Date(v.publishedAt))}${
					v.versionType === 'release' ? '' : ` (${v.versionType})`
				}${isOlder(v.id) ? ' · older' : ''}`
			}))
	);

	const isOlder = (versionId?: string) => {
		const at = data.versions.findIndex((v) => v.id === versionId);
		return position >= 0 && at > position;
	};

	let picked = $state<string>();
	let backup = $state(true);
	let replaceConfigs = $state(false);
	// nothing is chosen for you when there is no newer release: going back must be deliberate
	const target = $derived(picked ?? newerReleases[0]?.id);
	const preview = $derived(
		target && !installing ? modpackUpdatePreview({ id, versionId: target, replaceConfigs }) : null
	);
	const name = (path: string) => path.split('/').pop() ?? path;

	const blocker = $derived(
		installing
			? 'Wait for the current install to finish.'
			: running
				? 'Stop the server to update it.'
				: null
	);

	// the install runs in the background; reload what the instance runs once it has finished
	let wasInstalling = false;
	$effect(() => {
		if (wasInstalling && !installing) {
			void modpackStatus(id).refresh();
			// the header and the Mods tab show what the update changed
			void getInstance(id).refresh();
			void installedMods(id).refresh();
			picked = undefined;
		}
		wasInstalling = installing;
	});

	async function update() {
		if (!target) return;
		try {
			await updateModpack({ id, versionId: target, backup, replaceConfigs });
			toast.info('Update started');
			await modpackStatus(id).refresh();
		} catch (e) {
			toast.error(
				(e as { body?: { message?: string } }).body?.message ?? 'Could not start the update'
			);
		}
	}
</script>

{#snippet fileList(title: string, items: string[], tone = '')}
	{#if items.length}
		<details class="text-sm">
			<summary class="cursor-pointer select-none {tone}">{title} ({items.length})</summary>
			<ul class="mt-1 grid gap-0.5 ps-4 text-xs text-muted-foreground">
				{#each items.slice(0, 50) as path (path)}
					<li class="truncate" title={path}>{name(path)}</li>
				{/each}
				{#if items.length > 50}<li>and {items.length - 50} more</li>{/if}
			</ul>
		</details>
	{/if}
{/snippet}

{#if !data.pack}
	<Empty.Root class="border">
		<Empty.Header>
			<Empty.Media variant="icon"><PackageOffIcon /></Empty.Media>
			<Empty.Title>Not created from a modpack</Empty.Title>
			<Empty.Description>
				Only servers made with "From modpack" can be updated here. Manage their mods on the Mods
				tab.
			</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{:else}
	<div class="grid max-w-2xl gap-4">
		<Card.Root>
			<Card.Header>
				<Card.Title>{data.pack.name}</Card.Title>
				<Card.Description>
					Version {data.pack.versionNumber} ·
					<a
						class="underline"
						href="https://modrinth.com/modpack/{data.pack.projectId}"
						target="_blank"
						rel="noreferrer">on Modrinth</a
					>
				</Card.Description>
				{#if newerReleases.length > 0}
					<Card.Action>
						<Badge variant="success">{newerReleases.length} newer</Badge>
					</Card.Action>
				{/if}
			</Card.Header>
		</Card.Root>

		{#if data.outcome}
			<div
				class="grid gap-2 rounded-md border px-3 py-2 text-sm {data.outcome.ok
					? 'border-success/40 bg-success/10'
					: 'border-danger/40 bg-danger/10'}"
				role={data.outcome.ok ? 'status' : 'alert'}
			>
				<p>{data.outcome.message}</p>
				{#if data.outcome.details?.length}
					<details>
						<summary class="cursor-pointer select-none">{data.outcome.details[0]}</summary>
						<ul class="mt-1 grid gap-0.5 ps-4 text-xs text-muted-foreground">
							{#each data.outcome.details.slice(1) as path (path)}<li>{path}</li>{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>Update</Card.Title>
				<Card.Description>
					Mods and configs the pack changed are updated. Files you changed yourself are left as they
					are, and so are the world and the mods you added.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if data.error}
					<p class="text-sm text-destructive" role="alert">
						Could not reach Modrinth: {data.error}
					</p>
				{:else if !others.length}
					<p class="text-sm text-muted-foreground">This is the only version of the pack.</p>
				{:else}
					<Field.Group>
						<Field.Field>
							<Field.Label for="pack-version">Version</Field.Label>
							<Combobox
								id="pack-version"
								{options}
								value={target ?? ''}
								disabled={installing || running}
								onValueChange={(value) => (picked = value)}
							/>
						</Field.Field>

						{#if installing}
							<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
								<Spinner />{row?.progress?.label ?? 'Updating'}…
							</p>
						{:else if preview?.loading}
							<div class="grid gap-2" role="status" aria-label="Loading">
								<Skeleton class="h-4 w-1/2" />
								<Skeleton class="h-4 w-1/3" />
							</div>
						{:else if preview?.error}
							<p class="text-sm text-destructive" role="alert">
								{(preview.error as { body?: { message?: string } }).body?.message ??
									'Could not read that version'}
							</p>
						{:else if preview?.current}
							{@const plan = preview.current}
							<div class="grid gap-2">
								{#if plan.loaderChange}
									<p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
										This version runs Minecraft {plan.mcVersion}{plan.loaderVersion
											? ` with ${plan.loader} ${plan.loaderVersion}`
											: ''}. The server is moved to it, and the world is upgraded the first time it
										starts.
									</p>
								{/if}
								{#if !plan.added.length && !plan.updated.length && !plan.remove.length && !plan.writeConfigs.length && !plan.removeConfigs.length && !plan.loaderChange}
									<p class="text-sm text-muted-foreground">Nothing in the files would change.</p>
								{/if}
								{@render fileList('Added', plan.added, 'text-success')}
								{@render fileList('Updated', plan.updated)}
								{@render fileList('Removed', plan.remove, 'text-danger')}
								{@render fileList('Configs written', plan.writeConfigs)}
								{@render fileList('Configs removed', plan.removeConfigs)}
								{@render fileList('Left as they are', plan.kept, 'text-warning')}
								{#if plan.downloadBytes}
									<p class="text-xs text-muted-foreground">
										About {formatBytes(plan.downloadBytes)} to download.
									</p>
								{/if}
							</div>

							{#if plan.conflicts.length}
								<div class="flex items-center gap-2">
									<Checkbox
										id="replace-configs"
										bind:checked={replaceConfigs}
										disabled={installing}
									/>
									<Label for="replace-configs">
										Replace the {plan.conflicts.length}
										{plan.conflicts.length === 1 ? 'config' : 'configs'} I changed with the pack's
									</Label>
								</div>
							{/if}
						{/if}

						<div class="flex items-center gap-2">
							<Checkbox id="pack-backup" bind:checked={backup} disabled={installing} />
							<Label for="pack-backup">Back up the server first (recommended)</Label>
						</div>

						<div class="flex flex-wrap items-center gap-3">
							<Button onClickPromise={update} disabled={!!blocker || !preview?.current}>
								{target
									? `${isOlder(target) ? 'Downgrade' : 'Update'} to ${others.find((v) => v.id === target)?.versionNumber}`
									: 'Choose a version'}
							</Button>
							{#if !target && !blocker}
								<span class="text-sm text-muted-foreground">You are on the newest release.</span>
							{/if}
							{#if blocker}<span class="text-sm text-muted-foreground">{blocker}</span>{/if}
						</div>
					</Field.Group>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
{/if}
