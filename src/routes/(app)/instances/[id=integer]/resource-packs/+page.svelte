<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import {
		publicUrl,
		removePack,
		serverPack,
		setPackOptions,
		setPublicUrl,
		useResourcePack
	} from '#lib/packs.remote.js';
	import PackUpload from '#lib/components/pack-upload.svelte';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
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

	// players download an uploaded pack from the panel, so they need an address that reaches it
	const configured = $derived(publicUrl());
	// writable derived: follows the saved value until the user types
	let address = $derived(configured.current ?? '');
	let browserOrigin = $state('');
	onMount(() => (browserOrigin = location.origin));
	const effective = $derived(address.trim() || configured.current || browserOrigin);
	const unreachable = $derived.by(() => {
		try {
			const host = new URL(effective).hostname;
			return (
				host === 'localhost' ||
				host.endsWith('.local') ||
				/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
				host === '[::1]'
			);
		} catch {
			return false;
		}
	});

	async function saveAddress() {
		try {
			await setPublicUrl(address);
			toast.success(address.trim() ? 'Public address saved' : 'Public address cleared', {
				description: 'Uploaded server packs now use it.'
			});
		} catch (e) {
			toast.error(message(e, 'Could not save the address'));
		}
	}

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
			await removePack({ id, kind: 'resourcepack', rowId });
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
				Players are prompted to download this pack when they join. Modrinth packs are downloaded
				from Modrinth; uploaded packs are served by this panel. Changes apply the next time the
				server starts.
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
					{#if current.current.manual}<Badge variant="secondary">Uploaded</Badge>{/if}
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
						<input id="required" class="size-4 accent-primary" {...required.as('checkbox')} />
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

	<Card.Root>
		<Card.Header>
			<Card.Title>Upload your own pack</Card.Title>
			<Card.Description>
				The file is stored in <code class="font-mono">resourcepacks/</code> and this panel serves it to
				players, so it needs an address players can reach.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<PackUpload
				instanceId={id}
				kind="resourcepack"
				noun="resource pack"
				hint="Must be a zip with pack.mcmeta at its top. Maximum 250 MB. Replaces the current server pack."
			/>
			<Field.Field>
				<Field.Label for="public-address">Public address of this panel</Field.Label>
				<div class="flex gap-2">
					<Input
						id="public-address"
						placeholder={browserOrigin || 'https://panel.example.com'}
						bind:value={address}
					/>
					<Button variant="outline" onClickPromise={saveAddress}>Save</Button>
				</div>
				<Field.Description>
					Players download uploaded packs from this address. Leave it empty to use the address you
					are browsing from ({browserOrigin}).
				</Field.Description>
				{#if unreachable}
					<p class="text-sm text-amber-600 dark:text-amber-500" role="alert">
						{new URL(effective).hostname} is a local address. Players outside this network will not be
						able to download the pack. Use a public address, or a Modrinth pack instead.
					</p>
				{/if}
			</Field.Field>
		</Card.Content>
	</Card.Root>

	<PackBrowser
		instanceId={id}
		kind="resourcepack"
		noun="resource pack"
		description="From Modrinth, for this Minecraft version. Choosing one replaces the current server pack."
		actionLabel="Use as server pack"
		{installedIds}
		onInstall={use}
	/>
</div>
