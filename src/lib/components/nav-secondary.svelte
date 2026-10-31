<script lang="ts">
	import type { Icon } from '@tabler/icons-svelte';
	import type { ComponentProps } from 'svelte';

	import type { WithoutChildren } from '#lib/utils.js';

	import * as Sidebar from '#lib/components/ui/sidebar/index.js';

	let {
		items,
		...restProps
	}: { items: { title: string; url: string; icon: Icon; badge?: string }[] } & WithoutChildren<
		ComponentProps<typeof Sidebar.Group>
	> = $props();
</script>

<Sidebar.Group {...restProps}>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each items as item (item.title)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton>
						{#snippet child({ props })}
							<a href={item.url} {...props}>
								<item.icon />
								<span>{item.title}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
					{#if item.badge}<Sidebar.MenuBadge>{item.badge}</Sidebar.MenuBadge>{/if}
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
