<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import AppSidebar from '#lib/components/app-sidebar.svelte';
	import SiteHeader from '#lib/components/site-header.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<Sidebar.Provider
	class="h-svh"
	style="--sidebar-width: calc(var(--spacing) * 72); --header-height: calc(var(--spacing) * 12);"
>
	<AppSidebar user={{ name: data.user.username, role: data.user.role }} />
	<Sidebar.Inset class="min-h-0 overflow-hidden">
		<SiteHeader />
		<!-- the app is exactly viewport-tall; this region scrolls, or a page bounds itself (console) -->
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div class="@container/main flex min-h-0 flex-1 flex-col gap-2">
				{@render children()}
			</div>
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
