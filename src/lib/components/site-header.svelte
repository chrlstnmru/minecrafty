<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import ThemeSwitcher from '#lib/components/theme-switcher.svelte';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { listInstances } from '#lib/instances.remote.js';
	import { findNavItem } from '#lib/nav.js';

	const instances = listInstances();
	const section = $derived(findNavItem(page.url.pathname));
	const instance = $derived(
		page.params.id ? instances.current?.find((i) => i.id === Number(page.params.id)) : undefined
	);
</script>

<header
	class="flex h-(--header-height) shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
>
	<div class="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
		<Sidebar.Trigger class="-ms-1" />
		<Separator orientation="vertical" class="mx-2 data-vertical:h-4 data-vertical:self-auto" />
		<Breadcrumb.Root>
			<Breadcrumb.List>
				{#if instance}
					<Breadcrumb.Item class="hidden md:block">
						<Breadcrumb.Link href="/instances">Instances</Breadcrumb.Link>
					</Breadcrumb.Item>
					<Breadcrumb.Separator class="hidden md:block" />
					<Breadcrumb.Item>
						<Breadcrumb.Page>{instance.name}</Breadcrumb.Page>
					</Breadcrumb.Item>
				{:else}
					<Breadcrumb.Item>
						<Breadcrumb.Page>{section?.title ?? 'Minecrafty'}</Breadcrumb.Page>
					</Breadcrumb.Item>
				{/if}
			</Breadcrumb.List>
		</Breadcrumb.Root>
		<div class="ms-auto"><ThemeSwitcher /></div>
	</div>
</header>
