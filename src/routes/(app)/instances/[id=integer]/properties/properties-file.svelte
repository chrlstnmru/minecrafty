<!-- server.properties as text, for the keys and comments the form has no field for. -->
<script lang="ts">
	import { toast } from 'svelte-sonner';

	import CodeEditor from '#lib/components/config-editor/code-editor.svelte';
	import SaveBar from '#lib/components/save-bar.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { saveServerPropertiesText, serverPropertiesText } from '#lib/properties.remote.js';

	let { id, dirty = $bindable(false) }: { id: number; dirty?: boolean } = $props();

	const file = $derived(serverPropertiesText(id));
	const saved = $derived(file.current?.text ?? '');
	let text = $derived(saved);

	// lines added or removed, so the bar has a count to show
	const changeCount = $derived.by(() => {
		const before = new Set(saved.split('\n'));
		const after = new Set(text.split('\n'));
		const count =
			[...after].filter((l) => !before.has(l)).length +
			[...before].filter((l) => !after.has(l)).length;
		return text === saved ? 0 : Math.max(1, count);
	});
	$effect(() => {
		dirty = changeCount > 0;
	});

	let saving = $state(false);
	async function save() {
		if (!changeCount || saving) return;
		saving = true;
		try {
			await saveServerPropertiesText({ id, text });
			toast.success('Properties saved');
		} catch (e) {
			toast.error((e as { body?: { message?: string } }).body?.message ?? 'Save failed');
		} finally {
			saving = false;
		}
	}
</script>

<Card.Root class="min-h-96 flex-1">
	<Card.Header>
		<Card.Title>server.properties</Card.Title>
		<Card.Description>
			The whole file. The port, resource pack and RCON lines are managed by the panel, so they are
			not shown here and saving keeps them as they are.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex min-h-0 flex-1 flex-col">
		{#if file.current}
			<CodeEditor
				bind:value={text}
				filename="server.properties"
				onsave={save}
				class="min-h-0 flex-1 rounded-md border"
			/>
		{:else}
			<Skeleton class="flex-1" />
		{/if}
	</Card.Content>
</Card.Root>

{#if changeCount}
	<SaveBar
		subject="server.properties"
		{changeCount}
		{saving}
		canSave
		onsave={save}
		ondiscard={() => (text = saved)}
	/>
{/if}
