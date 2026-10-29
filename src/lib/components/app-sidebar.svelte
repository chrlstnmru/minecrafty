<script lang="ts">
	import CubeIcon from '@tabler/icons-svelte/icons/cube';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { navMain, navSecondary } from '#lib/nav.js';
	import NavMain from './nav-main.svelte';
	import NavSecondary from './nav-secondary.svelte';
	import NavUser from './nav-user.svelte';
	import type { ComponentProps } from 'svelte';

	// Placeholder until auth exists
	const user = { name: 'admin', email: 'admin@localhost', avatar: '' };

	let { ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton class="data-[slot=sidebar-menu-button]:!p-1.5">
					{#snippet child({ props })}
						<a href="/" {...props}>
							<CubeIcon class="!size-5" />
							<span class="text-base font-semibold">Minecrafty</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain items={navMain} />
		<NavSecondary items={navSecondary} class="mt-auto" />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser {user} />
	</Sidebar.Footer>
</Sidebar.Root>
