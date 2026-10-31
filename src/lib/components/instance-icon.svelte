<script lang="ts">
	import type { Picture } from 'vite-imagetools';

	import { cn } from '#lib/utils.js';

	// the loaders' icons live in the repo; the plugin resizes them and serves them with hashed names
	const loaderIcons = import.meta.glob<Picture>('/src/lib/assets/loaders/*.png', {
		eager: true,
		query: { enhanced: true, w: '40;80' },
		import: 'default'
	});

	/** A modpack's own icon when the instance came from one, else the icon of its loader. */
	let {
		loader,
		packIconUrl = null,
		class: className
	}: { loader: string; packIconUrl?: string | null; class?: string } = $props();

	// a pack icon that no longer loads falls back to the loader's
	let broken = $state(false);
	const picture = $derived(loaderIcons[`/src/lib/assets/loaders/${loader}.png`]);
</script>

{#if packIconUrl && !broken}
	<img
		src={packIconUrl}
		alt=""
		loading="lazy"
		class={cn('size-8 shrink-0 rounded-md bg-muted object-cover', className)}
		onerror={() => (broken = true)}
	/>
{:else if picture}
	<enhanced:img
		src={picture}
		alt=""
		sizes="40px"
		class={cn('size-8 shrink-0 rounded-md bg-muted p-1', className)}
	/>
{:else}
	<span class={cn('size-8 shrink-0 rounded-md bg-muted', className)}></span>
{/if}
