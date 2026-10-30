<script lang="ts">
	import SearchOffIcon from '@tabler/icons-svelte/icons/search-off';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		importModpack,
		modpackPreview,
		modpackVersions,
		searchModpacks
	} from '#lib/modpacks.remote.js';
	import * as Form from '#lib/components/form/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import SkeletonRows from '#lib/components/skeleton-rows.svelte';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { importModpackSchema } from '#lib/schemas/modpack.js';
	import EulaCheckbox from './eula-checkbox.svelte';

	let { onDone }: { onDone: () => void } = $props();

	const { versionId: versionIdField, name, port, ramMaxMb, eulaAccepted } = importModpack.fields;

	const PAGE_SIZE = 20;
	const number = new Intl.NumberFormat('en', { notation: 'compact' });
	const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

	let query = $state('');
	let debounced = $state('');
	let limit = $state(PAGE_SIZE);

	// wait for a pause in typing before asking Modrinth
	$effect(() => {
		const value = query;
		const timer = setTimeout(() => {
			debounced = value;
			limit = PAGE_SIZE;
		}, 300);
		return () => clearTimeout(timer);
	});

	type Picked = { projectId: string; title: string; iconUrl: string | null; author: string };
	let picked = $state<Picked | null>(null);
	let versionId = $state('');

	const results = $derived(picked ? null : searchModpacks({ query: debounced, limit }));
	const versions = $derived(picked ? modpackVersions(picked.projectId) : null);
	const preview = $derived(versionId ? modpackPreview(versionId) : null);

	// default to the newest stable version once the list arrives
	$effect(() => {
		const list = versions?.current;
		if (!list?.length || list.some((v) => v.id === versionId)) return;
		versionId = (list.find((v) => v.versionType === 'release') ?? list[0]).id;
	});

	// the form follows the selection: the hidden version, and the pack's title as a default name
	$effect(() => {
		versionIdField.set(versionId);
	});
	// only when a pack is picked: choosing another version must not overwrite a name typed since
	$effect(() => {
		const title = picked?.title;
		// untracked: setting the field reads its value, which would re-run this on every keystroke
		if (title) untrack(() => name.set(title));
	});

	function change() {
		picked = null;
		versionId = '';
	}

	const versionLabel = (v: {
		versionNumber: string;
		gameVersions: string[];
		loaders: string[];
		versionType: string;
	}) =>
		`${v.versionNumber} · ${v.gameVersions.at(-1) ?? '?'} · ${v.loaders.join(', ')}${v.versionType === 'release' ? '' : ` (${v.versionType})`}`;
</script>

{#if !picked}
	<div class="flex min-h-0 flex-1 flex-col gap-3">
		<InputGroup.Root class="shrink-0">
			<InputGroup.Addon align="inline-start">
				{#if results?.loading}<Spinner />{:else}<SearchIcon />{/if}
			</InputGroup.Addon>
			<InputGroup.Input
				bind:value={query}
				placeholder="Search Modrinth modpacks…"
				autocomplete="off"
				spellcheck="false"
			/>
		</InputGroup.Root>
		{#if results?.error}
			<p class="text-sm text-destructive" role="alert">Search failed. Try again shortly.</p>
		{/if}
		<div class="-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto px-1">
			{#if !results?.current && !results?.error}<SkeletonRows count={6} />{/if}
			{#each results?.current?.hits ?? [] as hit (hit.project_id)}
				<button
					type="button"
					class="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-start hover:bg-muted/60"
					onclick={() =>
						(picked = {
							projectId: hit.project_id,
							title: hit.title,
							iconUrl: hit.icon_url,
							author: hit.author
						})}
				>
					{#if hit.icon_url}
						<img src={hit.icon_url} alt="" class="size-10 shrink-0 rounded-md bg-muted" />
					{:else}
						<div class="size-10 shrink-0 rounded-md bg-muted"></div>
					{/if}
					<span class="min-w-0 flex-1">
						<span class="flex min-w-0 items-baseline gap-2">
							<span class="truncate text-sm font-medium">{hit.title}</span>
							{#if hit.server_side === 'unsupported'}<Badge variant="warning">Client only</Badge
								>{/if}
							<span class="shrink-0 text-xs text-muted-foreground">
								{number.format(hit.downloads)} downloads
							</span>
						</span>
						<span class="line-clamp-1 text-xs text-muted-foreground">{hit.description}</span>
					</span>
				</button>
			{:else}
				{#if results?.current}
					<Empty.Root class="border">
						<Empty.Header>
							<Empty.Media variant="icon"><SearchOffIcon /></Empty.Media>
							<Empty.Title>No modpacks found</Empty.Title>
							<Empty.Description>Try a different search.</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				{/if}
			{/each}
			{#if results?.current && results.current.hits.length < results.current.total}
				<div class="py-2">
					<Button variant="outline" size="sm" onclick={() => (limit += PAGE_SIZE)}>Show more</Button
					>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<Form.Root
		schema={importModpackSchema}
		remoteFunction={importModpack}
		class="flex min-h-0 flex-1 flex-col gap-4"
		onSubmitted={(succeeded) => {
			if (!succeeded) return;
			toast.success(`Importing ${picked?.title}`, {
				description: 'It appears in the list and keeps installing in the background.'
			});
			onDone();
		}}
	>
		{#snippet children({ pending })}
			<div class="-mx-1 flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
				<div class="flex items-center gap-3">
					{#if picked?.iconUrl}
						<img src={picked.iconUrl} alt="" class="size-10 shrink-0 rounded-md bg-muted" />
					{:else}
						<div class="size-10 shrink-0 rounded-md bg-muted"></div>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium">{picked?.title}</div>
						<div class="text-xs text-muted-foreground">by {picked?.author}</div>
					</div>
					<Button type="button" variant="ghost" size="sm" onclick={change}>Change</Button>
				</div>

				<input {...versionIdField.as('text')} type="hidden" value={versionId} />
				<Field.Field data-invalid={!!versionIdField.issues()?.length}>
					<Field.Label for="modpack-version">Version</Field.Label>
					<SelectMenu
						id="modpack-version"
						bind:value={versionId}
						disabled={!versions?.current}
						options={(versions?.current ?? []).map((v) => ({
							value: v.id,
							label: versionLabel(v)
						}))}
					/>
					<Field.Error errors={versionIdField.issues()} />
				</Field.Field>

				<div class="rounded-lg border bg-muted/30 p-3 text-sm">
					{#if preview?.loading && !preview.current}
						<div class="grid gap-2" role="status" aria-label="Reading the modpack">
							<Skeleton class="h-4 w-1/2" />
							<Skeleton class="h-4 w-2/3" />
							<Skeleton class="h-4 w-1/3" />
						</div>
					{:else if preview?.error}
						<p class="text-destructive" role="alert">Could not read this modpack version.</p>
					{:else if preview?.current}
						{@const s = preview.current}
						<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
							<dt class="text-muted-foreground">Minecraft</dt>
							<dd>{s.mcVersion}</dd>
							<dt class="text-muted-foreground">Loader</dt>
							<dd>
								<Badge variant="pink">{s.loader}</Badge>
								{#if s.loaderVersion}<span class="text-muted-foreground">{s.loaderVersion}</span
									>{/if}
							</dd>
							<dt class="text-muted-foreground">Downloads</dt>
							<dd>
								{s.files} files{s.downloadBytes ? `, ${megabytes(s.downloadBytes)}` : ''}
								{#if s.clientOnly}
									<span class="text-muted-foreground">({s.clientOnly} client-only skipped)</span>
								{/if}
							</dd>
							{#if s.overrides}
								<dt class="text-muted-foreground">Config</dt>
								<dd>{s.overrides} files copied from the pack</dd>
							{/if}
						</dl>
					{/if}
				</div>

				<Field.Group>
					<Form.Input label="Name" field={name} />
					<div class="grid grid-cols-2 gap-4">
						<Form.Input label="Port" type="number" field={port} />
						<Form.Input label="Max RAM (MB)" type="number" field={ramMaxMb} />
					</div>
					<EulaCheckbox field={eulaAccepted} />
					<Form.Errors form={importModpack} />
				</Field.Group>
			</div>
			<Button
				type="submit"
				class="w-full shrink-0"
				disabled={!preview?.current}
				loading={pending > 0}
			>
				Import modpack
			</Button>
		{/snippet}
	</Form.Root>
{/if}
