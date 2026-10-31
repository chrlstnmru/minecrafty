<script lang="ts">
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { onMount } from 'svelte';

	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';

	// The stored preference only exists in the browser; wait for mount so the
	// server-rendered markup and the first client render agree.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	const current = $derived(mounted ? userPrefersMode.current : undefined);

	const options = [
		{ value: 'system', label: 'Match system', icon: MonitorIcon },
		{ value: 'light', label: 'Light', icon: SunIcon },
		{ value: 'dark', label: 'Dark', icon: MoonIcon }
	] as const;
	type Mode = (typeof options)[number]['value'];
</script>

<!-- Getter returns the stored mode, so clicking the active item can't deselect it. -->
<ToggleGroup.Root
	type="single"
	size="sm"
	spacing={0.5}
	aria-label="Theme"
	class="rounded-lg border p-0.5"
	bind:value={() => current ?? '', (next) => next && setMode(next as Mode)}
>
	{#each options as option (option.value)}
		<ToggleGroup.Item
			value={option.value}
			title={option.label}
			aria-label={option.label}
			class="size-6 min-w-6 px-0 text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground"
		>
			<option.icon />
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
