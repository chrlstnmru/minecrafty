<script lang="ts">
	import { goto } from '$app/navigation';
	import CopyIcon from '@tabler/icons-svelte/icons/copy';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import PlusIcon from '@tabler/icons-svelte/icons/plus';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import UploadIcon from '@tabler/icons-svelte/icons/upload';
	import { toast } from 'svelte-sonner';

	import { deleteLocalPack, duplicateLocalPack, listLocalPacks } from '#lib/builder.remote.js';
	import * as DataTable from '#lib/components/data-table/index.js';
	import {
		createColumns,
		createDataTable,
		dateCell,
		renderSnippet
	} from '#lib/components/data-table/index.js';
	import InstanceIcon from '#lib/components/instance-icon.svelte';
	import LoaderBadge from '#lib/components/loader-badge.svelte';
	import NewPackDialog from '#lib/components/new-pack-dialog.svelte';
	import PageHeader from '#lib/components/page-header.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';

	import type { PageProps } from './$types';

	type Row = Awaited<ReturnType<typeof listLocalPacks>>[number];

	let { data }: PageProps = $props();
	const packs = listLocalPacks();
	const canWrite = $derived(data.panel.includes('modpacks.write'));

	let creating = $state(false);
	let removing = $state<Row | null>(null);
	let importing = $state(false);
	let fileInput = $state<HTMLInputElement>();

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	const col = createColumns<Row>();
	const columns = col.columns([
		col.accessor('name', {
			header: 'Pack',
			cell: ({ row }) => renderSnippet(nameCell, row.original),
			meta: { stack: 'title' }
		}),
		col.accessor('loader', {
			header: 'Loader',
			cell: ({ row }) => renderSnippet(loaderCell, row.original),
			meta: { stack: 'subtitle' }
		}),
		col.accessor('mcVersion', { header: 'Minecraft', meta: { stack: 'subtitle' } }),
		col.accessor('files', { header: 'Files', meta: { stack: 'subtitle', align: 'end' } }),
		col.accessor('updatedAt', {
			header: 'Changed',
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

	const table = createDataTable({
		columns,
		url: true,
		get data(): Row[] {
			return packs.current ?? [];
		},
		getRowId: (p) => String(p.id),
		initialState: { sorting: [{ id: 'updatedAt', desc: true }] }
	});

	async function duplicate(row: Row) {
		try {
			const { id } = await duplicateLocalPack({ id: row.id });
			toast.success(`Copied ${row.name}`);
			await goto(`/modpacks/${id}`);
		} catch (e) {
			toast.error(message(e, 'Could not copy the pack'));
		}
	}

	async function remove() {
		if (!removing) return;
		const row = removing;
		removing = null;
		try {
			await deleteLocalPack({ id: row.id });
			toast.success(`Deleted ${row.name}`);
		} catch (e) {
			toast.error(message(e, 'Could not delete the pack'));
		}
	}

	async function importFile(file: File | undefined) {
		if (!file) return;
		importing = true;
		try {
			const body = new FormData();
			body.set('file', file);
			const res = await fetch('/modpacks/import', { method: 'POST', body });
			if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message);
			const { id } = (await res.json()) as { id: number };
			toast.success('Pack imported');
			await goto(`/modpacks/${id}`);
		} catch (e) {
			toast.error(e instanceof Error && e.message ? e.message : 'Could not import the pack');
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<svelte:head><title>Modpack builder · Minecrafty</title></svelte:head>

{#snippet srOnly(label: string)}
	<span class="sr-only">{label}</span>
{/snippet}

{#snippet nameCell(p: Row)}
	<div class="flex min-w-0 items-center gap-3">
		<InstanceIcon loader={p.loader} packIconUrl={p.iconUrl} />
		<div class="grid min-w-0">
			<a href="/modpacks/{p.id}" class="truncate font-medium hover:underline">{p.name}</a>
			<span class="text-xs text-muted-foreground">revision {p.revision}</span>
		</div>
	</div>
{/snippet}

{#snippet loaderCell(p: Row)}
	<LoaderBadge loader={p.loader} />
{/snippet}

{#snippet actionsCell(p: Row)}
	<div class="flex justify-end gap-1">
		{@render tip('Download as .mrpack', DownloadIcon, 'Download', () =>
			window.location.assign(`/modpacks/${p.id}/export`)
		)}
		{#if canWrite}
			{@render tip('Make a copy', CopyIcon, 'Duplicate', () => duplicate(p))}
			{@render tip('Delete the pack', TrashIcon, 'Delete', () => (removing = p))}
		{/if}
	</div>
{/snippet}

{#snippet tip(text: string, Icon: typeof DownloadIcon, label: string, run: () => void)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon" aria-label="{label} pack" onclick={run}>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{text}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader
		title="Modpack builder"
		description="Build a modpack of your own, download it as a Modrinth .mrpack, or make a server from it."
	>
		{#snippet actions()}
			{#if canWrite}
				<input
					bind:this={fileInput}
					type="file"
					accept=".mrpack,application/zip"
					class="hidden"
					onchange={(e) => importFile(e.currentTarget.files?.[0])}
				/>
				<Button variant="outline" loading={importing} onclick={() => fileInput?.click()}>
					<UploadIcon />Import .mrpack
				</Button>
				<Button onclick={() => (creating = true)}><PlusIcon />New pack</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<DataTable.Root {table}>
		<DataTable.Toolbar>
			<DataTable.Search placeholder="Search packs" />
		</DataTable.Toolbar>
		<DataTable.Content {table} loading={!packs.current}>
			{#snippet empty()}
				<Empty.Root class="p-8">
					<Empty.Header>
						<Empty.Title>No packs yet</Empty.Title>
						<Empty.Description>
							{canWrite
								? 'Start a new pack, or import an .mrpack from Modrinth.'
								: 'Nobody has made a pack yet.'}
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{/snippet}
		</DataTable.Content>
		<DataTable.Pagination noun={['pack', 'packs']} />
	</DataTable.Root>
</div>

<NewPackDialog bind:open={creating} />

<AlertDialog.Root open={!!removing} onOpenChange={(o) => !o && (removing = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {removing?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				The pack and its config files are removed. Servers already made from it are not touched.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
