<script lang="ts">
	import CubeIcon from '@tabler/icons-svelte/icons/cube';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { navMain, navSecondary } from '#lib/nav.js';
	import { visibleItems } from '#lib/nav-access.js';
	import NavMain from './nav-main.svelte';
	import NavSecondary from './nav-secondary.svelte';
	import NavUser from './nav-user.svelte';
	import type { ComponentProps } from 'svelte';

	let {
		user,
		panel,
		anywhere,
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & {
		user: { name: string; role: string };
		panel: readonly string[];
		anywhere: readonly string[];
	} = $props();

	const ctx = $derived({
		admin: user.role === 'admin',
		held: new Set([...panel, ...anywhere])
	});
</script>

<Sidebar.Root collapsible="icon" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<a href="/" {...props}>
							<div
								class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
							>
								<CubeIcon class="size-4" />
							</div>
							<div class="grid flex-1 text-start text-sm leading-tight">
								<span class="truncate font-semibold">Minecrafty</span>
								<span class="truncate text-xs text-muted-foreground">Server panel</span>
							</div>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain items={visibleItems(navMain, ctx)} />
		<NavSecondary items={visibleItems(navSecondary, ctx)} class="mt-auto" />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser {user} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
