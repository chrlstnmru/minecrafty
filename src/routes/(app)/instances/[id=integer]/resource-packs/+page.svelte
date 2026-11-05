<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	import type { ModListItem } from '#lib/mod-list.js';

	import * as Form from '#lib/components/form/index.js';
	import InstalledBrowseTabs from '#lib/components/installed-browse-tabs.svelte';
	import ModList from '#lib/components/mod-list.svelte';
	import ModVersionsSheet from '#lib/components/mod-versions-sheet.svelte';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { viewParam } from '#lib/installed-browse.svelte.js';
	import { removePack, serverPack, setPackOptions, useResourcePack } from '#lib/packs.remote.js';
	import { packOptionsSchema } from '#lib/schemas/packs.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const current = $derived(await serverPack(id));
	const pack = $derived(current.pack);
	const installedIds = $derived(new Set(pack ? [pack.projectId] : []));
	const items = $derived<ModListItem[]>(
		pack
			? [
					{
						key: String(pack.id),
						id: pack.id,
						projectId: pack.projectId,
						title: pack.title,
						iconUrl: pack.iconUrl,
						// a server pack is a download link for players, not a file on this host
						file: '',
						versionNumber: pack.versionNumber,
						versionId: pack.versionId,
						dependencyOf: null,
						clientSide: null,
						serverSide: null,
						enabled: true,
						fromModrinth: pack.source === 'modrinth'
					}
				]
			: []
	);
	const { required, prompt } = setPackOptions.fields;
	const defaultFormValues = () => ({
		id,
		required: current.required,
		prompt: current.prompt
	});
	setPackOptions.fields.set(defaultFormValues());

	const view = viewParam();

	let pickerOpen = $state(false);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	async function use(projectId: string, title: string, versionId?: string) {
		try {
			const res = await useResourcePack({ id, projectId, versionId });
			toast.success(`${title} is now the server resource pack`, {
				description: `${res.version}. Applies the next time the server starts.`
			});
		} catch (e) {
			toast.error(message(e, 'Could not set the resource pack'));
		}
	}

	async function clear(rowId: number) {
		try {
			await removePack({ id, rowId });
			toast.success('Server resource pack removed');
		} catch (e) {
			toast.error(message(e, 'Remove failed'));
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<InstalledBrowseTabs {view} count={items.length} />

	<!-- the tabs stay put and the open tab scrolls; the padding keeps a card's ring from being clipped -->
	<div class="-m-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1">
		{#if view.current === 'installed'}
			<Card.Root>
				<Card.Header>
					<Card.Title>Server resource pack</Card.Title>
					<Card.Description>
						Players are prompted to download this pack from Modrinth when they join. Nothing is
						stored on this host. Changes apply the next time the server starts.
					</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-4">
					{#if current.externalUrl}
						<p class="text-sm text-muted-foreground">
							A pack is set in server.properties outside this panel:
							<span class="font-mono break-all">{current.externalUrl}</span>
						</p>
					{/if}
					{#if pack || !current.externalUrl}
						<ModList
							{items}
							noun="resource pack"
							filterable={false}
							onVersions={() => (pickerOpen = true)}
							onRemove={(item) => clear(item.id!)}
							onBrowse={() => (view.current = 'browse')}
						/>
					{/if}

					<Separator />

					<Form.Root
						schema={packOptionsSchema}
						remoteFunction={setPackOptions}
						onSubmitted={(succeeded) => {
							if (succeeded) toast.success('Options saved');
						}}
					>
						{#snippet children({ pending })}
							<input {...setPackOptions.fields.id.as('number')} type="hidden" />
							<Field.Group>
								<Form.Checkbox
									field={required}
									label="Require the pack (players who decline are kicked)"
								/>
								<Form.Input
									label="Prompt message"
									field={prompt}
									placeholder="Shown with the download prompt"
								/>
								<Form.Errors form={setPackOptions} />
								<div>
									<Button type="submit" variant="outline" loading={pending > 0}>Save options</Button
									>
								</div>
							</Field.Group>
						{/snippet}
					</Form.Root>
				</Card.Content>
			</Card.Root>
		{:else}
			<PackBrowser
				instanceId={id}
				noun="resource pack"
				description="From Modrinth, for this Minecraft version. Choosing one replaces the current server pack."
				actionLabel="Use as server pack"
				{installedIds}
				onInstall={use}
			/>
		{/if}
	</div>
</div>

{#if pack}
	<ModVersionsSheet
		bind:open={pickerOpen}
		kind="resourcepack"
		instanceId={id}
		projectId={pack.projectId}
		title={pack.title}
		noun="resource pack"
		currentVersionId={pack.versionId}
		onSelect={(versionId) => use(pack!.projectId, pack!.title, versionId)}
	/>
{/if}
