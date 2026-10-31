<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		checkForUpdates,
		installUpdate,
		setUpdateChannel,
		updateInfo
	} from '#lib/updates.remote.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	const info = updateInfo();
	const upd = $derived(info.current);

	// set once the owner asked for an update, until the panel comes back on the new version
	let target = $state<string | null>(null);
	const updating = $derived(!!target && upd?.current !== target && upd?.status?.state !== 'failed');

	// the panel restarts during an update, so keep asking until it answers with the new version
	$effect(() => {
		if (!target) return;
		const timer = setInterval(() => void info.refresh().catch(() => {}), 3000);
		return () => clearInterval(timer);
	});
	$effect(() => {
		if (!target || !upd) return;
		if (upd.current === target) {
			toast.success(`Minecrafty is now ${target}`);
			target = null;
		} else if (upd.status?.state === 'failed' && upd.status.version === target) {
			toast.error(upd.status.message ?? 'The update failed');
			target = null;
		}
	});

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	async function check() {
		try {
			await checkForUpdates();
		} catch (e) {
			toast.error(message(e, 'Could not check for updates'));
		}
	}

	async function install(version: string) {
		try {
			await installUpdate({ version });
			target = version;
		} catch (e) {
			toast.error(message(e, 'Could not start the update'));
		}
	}

	async function switchChannel(channel: string) {
		// a single toggle group lets the owner untoggle the current item; keep the channel instead
		if ((channel !== 'release' && channel !== 'prerelease') || channel === upd?.channel) return;
		try {
			await setUpdateChannel(channel);
		} catch (e) {
			toast.error(message(e, 'Could not change the update channel'));
		}
	}

	const when = (ms: number) => new Date(ms).toLocaleString();
	const command = $derived(
		`curl -fsSL https://raw.githubusercontent.com/${upd?.repo ?? 'chrlstnmru/minecrafty'}/main/scripts/install.sh | sudo bash`
	);
</script>

<svelte:head><title>Settings · Minecrafty</title></svelte:head>

<div class="flex flex-col gap-4 p-4 lg:p-6">
	<PageHeader title="Settings" description="What only the owner looks after." />

	<Card.Root class="max-w-2xl">
		<Card.Header>
			<Card.Title>Updates</Card.Title>
			<Card.Description>
				Minecrafty checks for a new release once a day and shows it here. Nothing is installed until
				you choose to. Game servers keep running while the panel restarts.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if !upd}
				<p class="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>
			{:else}
				<div class="grid gap-2">
					<span class="text-sm font-medium" id="update-channel">Update channel</span>
					<ToggleGroup.Root
						type="single"
						variant="outline"
						size="sm"
						class="w-fit"
						value={upd.channel}
						disabled={updating}
						aria-labelledby="update-channel"
						onValueChange={switchChannel}
					>
						<ToggleGroup.Item value="release" class="data-[state=on]:bg-primary/15">
							Releases
						</ToggleGroup.Item>
						<ToggleGroup.Item value="prerelease" class="data-[state=on]:bg-primary/15">
							Pre-releases
						</ToggleGroup.Item>
					</ToggleGroup.Root>
					<p class="text-xs text-muted-foreground">
						{upd.channel === 'prerelease'
							? 'Also offers test builds before they become a release. They can have bugs; switching back to Releases waits for the next release rather than going back.'
							: 'Only finished releases are offered.'}
					</p>
				</div>

				<dl class="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
					<dt class="text-muted-foreground">Running</dt>
					<dd>{upd.current === 'dev' ? 'a development build' : upd.current}</dd>
					<dt class="text-muted-foreground">Latest</dt>
					<dd>
						{#if upd.latest}
							<a
								class="underline underline-offset-4"
								href={upd.latest.url}
								target="_blank"
								rel="noreferrer">{upd.latest.version}</a
							>
							{#if upd.latest.prerelease}<Badge variant="warning" class="ms-2">Pre-release</Badge
								>{/if}
							{#if upd.available}<Badge class="ms-2">New</Badge>{/if}
						{:else if upd.checkedAt}
							none published yet
						{:else}
							not checked yet
						{/if}
					</dd>
					<dt class="text-muted-foreground">Last checked</dt>
					<dd>
						{upd.checkedAt ? when(upd.checkedAt) : 'not yet'}
						{#if upd.error}<span class="text-destructive"> · {upd.error}</span>{/if}
					</dd>
				</dl>

				{#if !updating && upd.status?.state === 'failed' && upd.status.version === upd.available?.version}
					<p class="text-sm text-destructive" role="alert">
						The last try at {upd.status.version} failed: {upd.status.message}
					</p>
				{/if}

				{#if updating}
					<p class="flex items-center gap-2 text-sm" role="status">
						<Spinner />Updating to {target}. The panel restarts in a moment; this page follows it.
					</p>
				{:else if upd.available}
					{#if upd.available.notes}
						<details class="rounded-md border p-3 text-sm">
							<summary class="cursor-pointer font-medium"
								>What is new in {upd.available.version}</summary
							>
							<p class="mt-2 whitespace-pre-wrap text-muted-foreground">{upd.available.notes}</p>
						</details>
					{/if}
					{#if upd.canInstall}
						<div>
							<Button onClickPromise={() => install(upd.available!.version)}>
								Update to {upd.available.version}
							</Button>
						</div>
					{:else}
						<div class="grid gap-2 text-sm">
							<p>
								This install cannot update itself from here. Run this on the server as root (on
								Windows, run the install script again from an elevated PowerShell):
							</p>
							<code class="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all"
								>{command}</code
							>
						</div>
					{/if}
				{/if}

				<div>
					<Button variant="outline" disabled={updating} onClickPromise={check}>Check now</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
