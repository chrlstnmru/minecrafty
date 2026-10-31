<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import ChevronDownIcon from '@tabler/icons-svelte/icons/chevron-down';
	import FilePlusIcon from '@tabler/icons-svelte/icons/file-plus';
	import PencilIcon from '@tabler/icons-svelte/icons/pencil';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import WandIcon from '@tabler/icons-svelte/icons/wand';
	import { toast } from 'svelte-sonner';

	import {
		getLocalPack,
		movePackConfig,
		readPackConfig,
		removePackOverride,
		savePackConfig
	} from '#lib/builder.remote.js';
	import CodeEditor from '#lib/components/config-editor/code-editor.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { formatConfig, formatKind } from '#lib/config-format.js';
	import { isEditable } from '#lib/editable.js';
	import { formatBytes } from '#lib/format.js';

	let {
		id,
		files,
		canWrite,
		class: className
	}: {
		id: number;
		files: { path: string; size: number }[];
		canWrite: boolean;
		class?: string;
	} = $props();

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
	const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

	const groups = $derived(
		Object.entries(Object.groupBy(files, (f) => dirOf(f.path)))
			.map(([dir, entries]) => ({ dir, entries: entries ?? [] }))
			.toSorted((a, b) => a.dir.localeCompare(b.dir))
	);

	let open = $state<string | null>(null);
	// a file made here that is not on the server until the first save
	let isNew = $state(false);
	let draft = $state('');
	let loaded = $state('');
	let hash = $state<string>();

	const file = $derived(open && !isNew ? readPackConfig({ id, path: open }) : null);
	const dirty = $derived(open !== null && draft !== loaded);

	// load the file into the editor when it is opened, and again after a save
	$effect(() => {
		const current = file?.current;
		if (!current) return;
		if (draft === loaded) draft = current.content;
		loaded = current.content;
		hash = current.hash;
	});

	let confirmDiscard = $state(false);
	let afterDiscard = $state<(() => void) | null>(null);

	/** Runs `action` now, or once the user has agreed to drop the unsaved edits. */
	function unlessDirty(action: () => void) {
		if (!dirty) return action();
		afterDiscard = action;
		confirmDiscard = true;
	}

	function discard() {
		draft = loaded;
		afterDiscard?.();
		afterDiscard = null;
	}

	// SvelteKit also runs this when the tab is closed or reloaded, where cancel() asks the browser
	beforeNavigate((navigation) => {
		if (!dirty) return;
		navigation.cancel();
		if (navigation.type === 'leave' || !navigation.to) return;
		const { url } = navigation.to;
		unlessDirty(() => void goto(url));
	});

	function show(path: string | null, created = false) {
		open = path;
		isNew = created;
		draft = '';
		loaded = '';
		hash = undefined;
	}

	async function reload() {
		draft = '';
		loaded = '';
		await file?.refresh();
	}

	async function save() {
		if (!open || !canWrite || !dirty) return;
		try {
			await savePackConfig({
				id,
				path: open,
				content: draft,
				baseHash: isNew ? undefined : hash
			});
			isNew = false;
			toast.success('Saved');
		} catch (e) {
			const text = message(e, 'Could not save the file');
			if (text.includes('changed since you opened it'))
				toast.error(text, { action: { label: 'Reload', onClick: () => unlessDirty(reload) } });
			else toast.error(text);
		}
	}

	async function format() {
		if (!open) return;
		try {
			draft = await formatConfig(open, draft);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not format this file');
		}
	}

	async function remove(path: string) {
		try {
			await removePackOverride({ id, path });
			if (open === path) show(null);
		} catch (e) {
			toast.error(message(e, 'Could not remove the file'));
		}
	}

	let naming = $state<{ from?: string; value: string } | null>(null);
	let namingOpen = $state(false);

	const nameError = $derived.by(() => {
		if (!naming) return undefined;
		const path = naming.value.trim();
		if (!path) return 'Enter a path, such as config/mod.toml';
		if (path.startsWith('/') || path.split('/').includes('..'))
			return 'Use a path inside the server folder, without a leading slash or ..';
		if (path !== naming.from && files.some((f) => f.path === path)) return `${path} already exists`;
		if (!naming.from && !isEditable(nameOf(path)))
			return 'Only text files can be made here: .toml, .json, .yml, .properties, .cfg, .xml, .md and similar';
		return undefined;
	});

	function startNaming(from?: string) {
		naming = { from, value: from ?? 'config/' };
		namingOpen = true;
	}

	async function confirmName() {
		if (!naming || nameError) return;
		const { from } = naming;
		const to = naming.value.trim();
		namingOpen = false;
		if (!from) return unlessDirty(() => show(to, true));
		if (from === to) return;
		try {
			await movePackConfig({ id, from, to });
			if (open === from) open = to;
			toast.success(`Moved ${from} to ${to}`);
		} catch (e) {
			toast.error(message(e, 'Could not move the file'));
		}
	}

	let folder = $state('config');
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();

	async function upload(chosen: File | undefined) {
		if (!chosen) return;
		uploading = true;
		try {
			const body = new FormData();
			body.set('file', chosen);
			body.set('path', folder);
			const res = await fetch(`/modpacks/${id}/overrides`, { method: 'POST', body });
			if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
			await getLocalPack({ id }).refresh();
			toast.success(`Added ${chosen.name}`);
		} catch (e) {
			toast.error(e instanceof Error && e.message ? e.message : 'Could not add the file');
		} finally {
			uploading = false;
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<Card.Root class={className}>
	<Card.Header>
		<Card.Title>Config files</Card.Title>
		<Card.Description>
			Copied into every server made from this pack, and into the .mrpack under overrides/.
		</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
		<div class="grid content-start gap-3">
			{#each groups as group (group.dir)}
				<Collapsible.Root open class="grid gap-1">
					<Collapsible.Trigger
						class="flex items-center gap-1 text-xs font-medium text-muted-foreground"
					>
						<ChevronDownIcon class="size-3.5" />
						<span class="truncate font-mono">{group.dir || '(server folder)'}</span>
					</Collapsible.Trigger>
					<Collapsible.Content class="grid gap-0.5">
						{#each group.entries as entry (entry.path)}
							<div
								class="flex items-center gap-1 rounded-md ps-2 {open === entry.path
									? 'bg-accent'
									: ''}"
							>
								{#if isEditable(entry.path)}
									<button
										type="button"
										class="min-w-0 flex-1 truncate py-1.5 text-start font-mono text-sm"
										aria-current={open === entry.path}
										onclick={() => unlessDirty(() => show(entry.path))}
									>
										{nameOf(entry.path)}
									</button>
								{:else}
									<span
										class="min-w-0 flex-1 truncate py-1.5 font-mono text-sm text-muted-foreground"
										title="Not a text file"
									>
										{nameOf(entry.path)}
									</span>
								{/if}
								<span class="shrink-0 text-xs text-muted-foreground">
									{formatBytes(entry.size)}
								</span>
								{#if canWrite}
									<Button
										variant="ghost"
										size="icon"
										aria-label="Rename {entry.path}"
										onclick={() => startNaming(entry.path)}
									>
										<PencilIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Remove {entry.path}"
										onClickPromise={() => remove(entry.path)}
									>
										<TrashIcon />
									</Button>
								{/if}
							</div>
						{/each}
					</Collapsible.Content>
				</Collapsible.Root>
			{:else}
				<p class="text-sm text-muted-foreground">No config files.</p>
			{/each}
			{#if canWrite}
				<div class="grid gap-3 border-t pt-3">
					<Button variant="outline" onclick={() => startNaming()}>
						<FilePlusIcon />New file
					</Button>
					<Field.Field>
						<Field.Label for="config-folder">Upload to folder</Field.Label>
						<Input id="config-folder" bind:value={folder} class="font-mono" autocomplete="off" />
					</Field.Field>
					<input
						bind:this={fileInput}
						type="file"
						class="hidden"
						onchange={(e) => upload(e.currentTarget.files?.[0])}
					/>
					<Button variant="outline" loading={uploading} onclick={() => fileInput?.click()}>
						<UploadIcon />Upload a file
					</Button>
				</div>
			{/if}
		</div>

		<div class="grid min-w-0 content-start gap-3">
			{#if open === null}
				<Empty.Root class="p-8">
					<Empty.Header>
						<Empty.Title>Choose a file</Empty.Title>
						<Empty.Description>
							Pick a text file on the left to read it{canWrite ? ', or make a new one' : ''}.
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				<div class="flex flex-wrap items-center gap-2">
					<span class="min-w-0 flex-1 truncate font-mono text-sm">{open}</span>
					{#if dirty}<span class="text-xs text-muted-foreground">Unsaved changes</span>{/if}
					{#if canWrite}
						{#if formatKind(open)}
							<Button variant="outline" onclick={format} disabled={file?.loading}>
								<WandIcon />Format
							</Button>
						{/if}
						<Button onClickPromise={save} disabled={!dirty}>Save</Button>
					{/if}
				</div>
				{#if file?.error}
					<p class="text-sm text-destructive" role="alert">
						{message(file.error, 'Could not open this file.')}
					</p>
				{:else if isNew || file?.current}
					{#key open}
						<CodeEditor
							bind:value={draft}
							filename={open}
							readonly={!canWrite}
							onsave={save}
							onformat={canWrite ? format : undefined}
							class="h-128"
						/>
					{/key}
				{/if}
			{/if}
		</div>
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={namingOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{naming?.from ? 'Rename or move' : 'New config file'}</Dialog.Title>
			<Dialog.Description>
				The path inside the server folder. A new folder in the path is made for you.
			</Dialog.Description>
		</Dialog.Header>
		{#if naming}
			<form
				class="grid gap-4"
				onsubmit={(e) => {
					e.preventDefault();
					void confirmName();
				}}
			>
				<Field.Field data-invalid={nameError ? true : undefined}>
					<Field.Label for="config-path">Path</Field.Label>
					<Input
						id="config-path"
						bind:value={naming.value}
						class="font-mono"
						autocomplete="off"
						aria-invalid={nameError ? true : undefined}
					/>
					{#if nameError}<Field.Error>{nameError}</Field.Error>{/if}
				</Field.Field>
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={() => (namingOpen = false)}>Cancel</Button>
					<Button type="submit" disabled={!!nameError}>
						{naming.from ? 'Move' : 'Create'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmDiscard}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard your changes?</AlertDialog.Title>
			<AlertDialog.Description>The edits to this file have not been saved.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={discard}>Discard</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
