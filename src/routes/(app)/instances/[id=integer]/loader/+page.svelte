<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { getInstance, listInstances } from '#lib/instances.remote.js';
	import { loaderBuilds, loaderStatus, updateLoader } from '#lib/loader.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Combobox from '#lib/components/combobox.svelte';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { updateKind } from '#lib/versions.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// awaited, so the server renders the page and the browser hydrates the same markup
	const info = $derived(await loaderStatus(id));
	const all = listInstances();
	const row = $derived(all.current?.find((i) => i.id === id));
	const installing = $derived(row?.installState === 'installing');
	const running = $derived(row?.state === 'running' || row?.state === 'stopping');

	let picked = $state<string>();
	let backup = $state(true);
	const target = $derived(picked ?? info.mcVersion);
	const kind = $derived(updateKind(info.mcVersion, target));

	// the builds of the chosen Minecraft version; the newest is used unless another is picked
	let pickedBuild = $state<string>();
	const builds = $derived(
		info.loader === 'vanilla' || info.error ? null : loaderBuilds({ id, mcVersion: target })
	);
	const newest = $derived(builds?.current?.[0] ?? (target === info.mcVersion ? info.latest : null));
	const build = $derived(
		pickedBuild && builds?.current?.includes(pickedBuild) ? pickedBuild : newest
	);
	const buildOptions = $derived(
		(builds?.current ?? []).map((b, i) => ({
			value: b,
			label:
				target === info.mcVersion && b === info.loaderVersion
					? `${b} (current)`
					: i === 0
						? `${b} (newest)`
						: b
		}))
	);
	const sameBuild = $derived(kind === 'build' && (build === null || build === info.loaderVersion));

	const options = $derived(
		(info.versions.includes(info.mcVersion)
			? info.versions
			: [info.mcVersion, ...info.versions]
		).map((version) => ({
			value: version,
			label: version === info.mcVersion ? `${version} (current)` : version
		}))
	);

	const noun = $derived(info.loader === 'vanilla' ? 'server jar' : `${info.loader} build`);
	const action = $derived(
		kind === 'build'
			? build && build !== newest
				? `Switch to ${build}`
				: `Update ${noun}`
			: kind === 'upgrade'
				? `Upgrade to ${target}`
				: `Downgrade to ${target}`
	);
	const blocker = $derived(
		installing
			? 'Wait for the current install to finish.'
			: running
				? 'Stop the server to update it.'
				: sameBuild
					? info.loader === 'vanilla'
						? 'Vanilla has one server jar per version, so there is nothing newer for this version.'
						: build === newest
							? 'Already on the newest build.'
							: 'This server already runs that build.'
					: null
	);

	// the install runs in the background; reload what the loader runs once it has finished
	let wasInstalling = false;
	$effect(() => {
		if (wasInstalling && !installing) {
			void loaderStatus(id).refresh();
			// the page header shows the version too
			void getInstance(id).refresh();
			picked = undefined;
			pickedBuild = undefined;
		}
		wasInstalling = installing;
	});

	async function update() {
		try {
			await updateLoader({
				id,
				mcVersion: target,
				build: info.loader === 'vanilla' ? undefined : (build ?? undefined),
				backup
			});
			toast.info('Update started');
			await loaderStatus(id).refresh();
		} catch (e) {
			toast.error(
				(e as { body?: { message?: string } }).body?.message ?? 'Could not start the update'
			);
		}
	}
</script>

<div class="grid max-w-2xl gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Installed</Card.Title>
			<Card.Description>What this server runs now.</Card.Description>
		</Card.Header>
		<Card.Content>
			<dl class="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
				<dt class="text-muted-foreground">Loader</dt>
				<dd class="capitalize">{info.loader}</dd>
				<dt class="text-muted-foreground">Minecraft</dt>
				<dd>{info.mcVersion}</dd>
				{#if info.loader !== 'vanilla'}
					<dt class="text-muted-foreground">Build</dt>
					<dd>
						{info.loaderVersion ?? 'unknown'}
						{#if info.latest && info.latest !== info.loaderVersion}
							<span class="text-success">· {info.latest} is available</span>
						{:else if info.latest}
							<span class="text-muted-foreground">· newest</span>
						{/if}
					</dd>
				{/if}
			</dl>
		</Card.Content>
	</Card.Root>

	{#if info.outcome}
		<p
			class="rounded-md border px-3 py-2 text-sm {info.outcome.ok
				? 'border-success/40 bg-success/10'
				: 'border-danger/40 bg-danger/10'}"
			role={info.outcome.ok ? 'status' : 'alert'}
		>
			{info.outcome.message}
		</p>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Update</Card.Title>
			<Card.Description>
				Installs the {info.loader} build you choose for a Minecraft version, the newest unless you pick
				another. The new files are prepared first, so a failed install leaves the current server as it
				is.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if row?.packProjectId}
				<p class="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
					This server follows the modpack {row.packName}, which decides its Minecraft version and
					loader build. Update it from the Modpack tab; changing the loader here can break the pack.
				</p>
			{/if}
			{#if info.error}
				<p class="text-sm text-destructive" role="alert">
					Could not reach the version service: {info.error}
				</p>
			{:else}
				<Field.Group>
					<Field.Field>
						<Field.Label for="mc-version">Minecraft version</Field.Label>
						<Combobox
							id="mc-version"
							{options}
							value={target}
							disabled={installing || running}
							onValueChange={(value) => (picked = value)}
						/>
					</Field.Field>
					{#if info.loader !== 'vanilla'}
						<Field.Field>
							<Field.Label for="loader-build">Build</Field.Label>
							{#if builds?.error}
								<p class="text-sm text-destructive" role="alert">Could not load the builds.</p>
							{:else}
								<Combobox
									id="loader-build"
									options={buildOptions}
									value={build ?? ''}
									disabled={installing || running || !buildOptions.length}
									placeholder={builds?.loading ? 'Loading builds…' : 'No builds'}
									onValueChange={(value) => (pickedBuild = value)}
								/>
							{/if}
						</Field.Field>
					{/if}

					{#if kind === 'upgrade'}
						<p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
							The world is upgraded to {target} the first time the server starts, and an older version
							cannot open it afterwards.
						</p>
					{:else if kind === 'downgrade'}
						<p class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
							A world that was opened in {info.mcVersion} can be damaged by {target}. Only go back
							with a backup you can restore.
						</p>
					{/if}
					{#if kind !== 'build' && info.mods > 0}
						<p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
							{info.mods}
							{info.mods === 1 ? 'mod is' : 'mods are'} installed for {info.mcVersion}. Check the
							Mods tab for compatible versions after the update; the ones that have none will fail
							to load.
						</p>
					{/if}

					<div class="flex items-center gap-2">
						<Checkbox id="backup-first" bind:checked={backup} disabled={installing} />
						<Label for="backup-first">Back up the server first (recommended)</Label>
					</div>

					{#if installing}
						<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
							<Spinner />{row?.progress?.label ?? 'Updating'}…
						</p>
					{/if}

					<div class="flex flex-wrap items-center gap-3">
						<Button onClickPromise={update} disabled={!!blocker}>{action}</Button>
						{#if blocker}<span class="text-sm text-muted-foreground">{blocker}</span>{/if}
					</div>
				</Field.Group>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
