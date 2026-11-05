<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	import Combobox from '#lib/components/combobox.svelte';
	import Notice from '#lib/components/notice.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { isFromPack } from '#lib/instance-origin.js';
	import { getInstance } from '#lib/instances.remote.js';
	import { liveProgress } from '#lib/live.svelte.js';
	import { loaderBuilds, loaderStatus, updateLoader } from '#lib/loader.remote.js';
	import { updateKind } from '#lib/versions.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// awaited, so the server renders the page and the browser hydrates the same markup
	const [info, row] = $derived(await Promise.all([loaderStatus(id), getInstance(id)]));
	const progress = liveProgress();
	const installing = $derived(row.installState === 'installing');
	const running = $derived(row.state === 'running' || row.state === 'stopping');

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

	// old Loader tab links land on #loader; the card renders after its data loads, too late for the browser's own jump
	$effect(() => {
		if (page.url.hash === '#loader') document.getElementById('loader')?.scrollIntoView();
	});
</script>

<Card.Root id="loader" class="scroll-mt-4">
	<Card.Header>
		<Card.Title>Loader</Card.Title>
		<Card.Description>
			{#if info.loader === 'vanilla'}
				Runs vanilla Minecraft {info.mcVersion}.
			{:else}
				Runs <span class="capitalize">{info.loader}</span>
				{info.loaderVersion ?? '(build unknown)'} on Minecraft {info.mcVersion}.
			{/if}
			The new files are prepared first, so a failed install leaves the server as it is.
		</Card.Description>
		{#if info.loader !== 'vanilla' && info.latest && info.latest !== info.loaderVersion}
			<Card.Action><Badge variant="success">{info.latest} available</Badge></Card.Action>
		{/if}
	</Card.Header>
	<Card.Content class="grid gap-4">
		{#if info.outcome}
			<Notice tone={info.outcome.ok ? 'success' : 'danger'}>{info.outcome.message}</Notice>
		{/if}
		{#if isFromPack(row)}
			<Notice tone="warning">
				This server follows the modpack {row.packName}, which decides its Minecraft version and
				loader build. Update it from the Modpack card; changing the loader here can break the pack.
			</Notice>
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
					<Notice tone="warning">
						The world is upgraded to {target} the first time the server starts, and an older version cannot
						open it afterwards.
					</Notice>
				{:else if kind === 'downgrade'}
					<Notice tone="danger">
						A world that was opened in {info.mcVersion} can be damaged by {target}. Only go back
						with a backup you can restore.
					</Notice>
				{/if}
				{#if kind !== 'build' && info.mods > 0}
					<Notice tone="warning">
						{info.mods}
						{info.mods === 1 ? 'mod is' : 'mods are'} installed for {info.mcVersion}. Check the Mods
						tab for compatible versions after the update; the ones that have none will fail to load.
					</Notice>
				{/if}

				<div class="flex items-center gap-2">
					<Checkbox id="backup-first" bind:checked={backup} disabled={installing} />
					<Label for="backup-first">Back up the server first (recommended)</Label>
				</div>

				{#if installing}
					<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
						<Spinner />{progress.current?.[id]?.label ?? 'Updating'}…
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
