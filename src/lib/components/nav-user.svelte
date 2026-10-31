<script lang="ts">
	import LogoutIcon from '@tabler/icons-svelte/icons/logout';
	import SelectorIcon from '@tabler/icons-svelte/icons/selector';

	import { logout } from '#lib/auth.remote.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';

	let { user }: { user: { name: string; role: string } } = $props();

	const sidebar = Sidebar.useSidebar();

	let logoutForm = $state<HTMLFormElement>();
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<!-- a client-side redirect would re-run this page's queries signed out and keep their 401s
		     cached, so signing back in without a reload showed an error page; skip that refresh and
		     load /login afresh, which also drops whatever the last user had on screen -->
		<form
			{...logout.enhance(async (form) => {
				await form.submit().updates();
				location.assign('/login');
			})}
			bind:this={logoutForm}
			hidden
		></form>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<Avatar.Root class="size-8 rounded-lg grayscale">
							<Avatar.Fallback class="rounded-lg"
								>{user.name.slice(0, 2).toUpperCase()}</Avatar.Fallback
							>
						</Avatar.Root>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs text-muted-foreground">
								{user.role}
							</span>
						</div>
						<SelectorIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<DropdownMenu.Label class="p-0 font-normal">
					<div class="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Fallback class="rounded-lg"
								>{user.name.slice(0, 2).toUpperCase()}</Avatar.Fallback
							>
						</Avatar.Root>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs text-muted-foreground">
								{user.role}
							</span>
						</div>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => logoutForm?.requestSubmit()}>
					<LogoutIcon />
					Log out
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
