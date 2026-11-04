<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { sideTags, type Side } from '#lib/mod-list.js';

	let {
		clientSide,
		serverSide,
		class: className
	}: { clientSide: Side; serverSide: Side; class?: string } = $props();

	const tags = $derived(sideTags(clientSide, serverSide));
	const both = $derived(tags.length === 2);

	const tag = {
		server: { label: 'Server', variant: 'warning' },
		client: { label: 'Client', variant: 'info' }
	} as const;

	const tip = $derived({
		server: both ? 'Runs on the server.' : 'Runs only on the server. Players do not install it.',
		client: both
			? 'Also runs in each player’s game.'
			: 'Runs only in each player’s game. It may stop a server from starting.'
	});
</script>

{#if tags.length}
	<span class="inline-flex gap-1 {className ?? ''}">
		{#each tags as side (side)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Badge {...props} variant={tag[side].variant}>{tag[side].label}</Badge>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{tip[side]}</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</span>
{/if}
