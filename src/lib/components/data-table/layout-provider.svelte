<script lang="ts">
	import type { Snippet } from 'svelte';

	import type { Layout } from './layout.js';

	import { setLayout } from './layout.js';

	let { layout, children }: { layout: Layout; children: Snippet } = $props();

	// svelte-ignore state_referenced_locally
	setLayout(layout);
</script>

{@render children()}
