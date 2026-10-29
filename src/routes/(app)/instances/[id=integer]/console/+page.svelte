<script lang="ts">
	import { page } from '$app/state';
	import ConsoleView from '#lib/components/console-view.svelte';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
</script>

<ConsoleView {id} />
