<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { removePack, serverPack, setPackOptions, useResourcePack } from '#lib/packs.remote.js';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import FormCheckbox from '#lib/components/form-checkbox.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const current = $derived(serverPack(id));
	const installedIds = $derived(
		new Set(current.current?.pack ? [current.current.pack.projectId] : [])
	);
	const { required, prompt } = setPackOptions.fields;

	// load the stored options into the form when they change
	$effect(() => {
		const c = current.current;
		if (!c) return;
		setPackOptions.fields.set({ id, required: c.required, prompt: c.prompt });
	});

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

<div class="grid gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Server resource pack</Card.Title>
			<Card.Description>
				Players are prompted to download this pack from Modrinth when they join. Nothing is stored
				on this host. Changes apply the next time the server starts.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if current.current?.pack}
				{@const pack = current.current.pack}
				<div class="flex items-center gap-3">
					{#if pack.iconUrl}
						<img src={pack.iconUrl} alt="" class="size-10 shrink-0 rounded-md bg-muted" />
					{:else}
						<div class="size-10 shrink-0 rounded-md bg-muted"></div>
					{/if}
					<div class="min-w-0 flex-1">
						<span class="truncate text-sm font-medium">{pack.title}</span>
						<p class="truncate text-xs text-muted-foreground">{pack.versionNumber}</p>
					</div>
					<Button variant="outline" size="sm" onClickPromise={() => clear(pack.id)}>Remove</Button>
				</div>
			{:else if current.current?.externalUrl}
				<p class="text-sm text-muted-foreground">
					A pack is set in server.properties outside this panel:
					<span class="font-mono break-all">{current.current.externalUrl}</span>
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">No server resource pack is set.</p>
			{/if}

			<form
				{...setPackOptions.enhance(async ({ submit }) => {
					await submit();
					if (!setPackOptions.fields.allIssues()?.length) toast.success('Options saved');
				})}
			>
				<input {...setPackOptions.fields.id.as('number')} type="hidden" />
				<Field.Group>
					<Field.Field orientation="horizontal">
						<FormCheckbox id="required" field={required} />
						<Field.Label for="required" class="font-normal">
							Require the pack (players who decline are kicked)
						</Field.Label>
					</Field.Field>
					<Field.Field data-invalid={!!prompt.issues()?.length}>
						<Field.Label for="prompt">Prompt message</Field.Label>
						<Input
							id="prompt"
							placeholder="Shown with the download prompt"
							{...prompt.as('text')}
						/>
						<Field.Error errors={prompt.issues()} />
					</Field.Field>
					<div>
						<Button type="submit" variant="outline" loading={setPackOptions.pending > 0}>
							Save options
						</Button>
					</div>
				</Field.Group>
			</form>
		</Card.Content>
	</Card.Root>

	<PackBrowser
		instanceId={id}
		noun="resource pack"
		description="From Modrinth, for this Minecraft version. Choosing one replaces the current server pack."
		actionLabel="Use as server pack"
		{installedIds}
		onInstall={use}
	/>
</div>
