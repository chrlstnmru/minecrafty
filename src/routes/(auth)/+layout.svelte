<script lang="ts">
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<main class="flex min-h-svh items-center justify-center bg-muted p-6">
	<div class="w-full max-w-sm">
		{@render children()}
	</div>
</main>
