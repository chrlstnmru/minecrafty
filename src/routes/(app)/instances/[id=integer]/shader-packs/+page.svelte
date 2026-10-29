<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { installShader, installedPacks, removePack } from '#lib/packs.remote.js';
	import PackBrowser from '#lib/components/pack-browser.svelte';
	import PackUpload from '#lib/components/pack-upload.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	const installed = $derived(installedPacks({ id, kind: 'shader' }));
	const installedIds = $derived(new Set(installed.current?.map((p) => p.projectId)));

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;

	async function install(projectId: string, title: string, versionId?: string) {
		try {
			const res = await installShader({ id, projectId, versionId });
			toast.success(`Downloaded ${title}`, { description: res.version });
		} catch (e) {
			toast.error(message(e, 'Download failed'));
		}
	}

	async function remove(rowId: number, title: string) {
		try {
			await removePack({ id, kind: 'shader', rowId });
			toast.success(`Removed ${title}`);
		} catch (e) {
			toast.error(message(e, 'Remove failed'));
		}
	}
</script>

<div class="grid gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Shader packs</Card.Title>
			<Card.Description>
				Servers do not run shaders. Packs are saved in <code class="font-mono">shaderpacks/</code> so
				they are included in backups and can be downloaded from the file manager to share with players.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#each installed.current ?? [] as pack (pack.id)}
				<div class="flex items-center gap-3 border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
					{#if pack.iconUrl}
						<img src={pack.iconUrl} alt="" class="size-9 shrink-0 rounded-md bg-muted" />
					{:else}
						<div class="size-9 shrink-0 rounded-md bg-muted"></div>
					{/if}
					<div class="min-w-0 flex-1">
						<span class="truncate text-sm font-medium">{pack.title}</span>
						<p class="truncate text-xs text-muted-foreground">
							{pack.source === 'manual' ? 'uploaded' : pack.versionNumber} · {pack.file}
						</p>
					</div>
					<Button variant="ghost" size="sm" onClickPromise={() => remove(pack.id, pack.title)}>
						Remove
					</Button>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No shader packs downloaded yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Content>
			<PackUpload
				instanceId={id}
				kind="shader"
				noun="shader pack"
				hint="Must be a zip with a shaders/ folder at its top. Maximum 250 MB."
			/>
		</Card.Content>
	</Card.Root>

	<PackBrowser
		instanceId={id}
		kind="shader"
		noun="shader pack"
		description="From Modrinth, for this Minecraft version."
		actionLabel="Download"
		{installedIds}
		onInstall={install}
	/>
</div>
