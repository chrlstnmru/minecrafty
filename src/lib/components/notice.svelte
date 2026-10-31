<script lang="ts">
	import AlertOctagonIcon from '@tabler/icons-svelte/icons/alert-octagon';
	import AlertTriangleIcon from '@tabler/icons-svelte/icons/alert-triangle';
	import CircleCheckIcon from '@tabler/icons-svelte/icons/circle-check';
	import type { Snippet } from 'svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { cn } from '#lib/utils.js';

	/**
	 * A banner in a page: an alert with the icon for its tone. Warnings and outcomes are announced
	 * politely (`status`); a danger interrupts (`alert`).
	 */
	let {
		tone,
		class: className,
		children
	}: { tone: 'warning' | 'success' | 'danger'; class?: string; children: Snippet } = $props();

	const Icon = $derived(
		tone === 'success' ? CircleCheckIcon : tone === 'danger' ? AlertOctagonIcon : AlertTriangleIcon
	);
</script>

<Alert.Root
	variant={tone}
	role={tone === 'danger' ? 'alert' : 'status'}
	class={cn('rounded-md px-3 py-2', className)}
>
	<Icon class="size-4" aria-hidden="true" />
	<Alert.Description class="text-sm text-foreground">{@render children()}</Alert.Description>
</Alert.Root>
