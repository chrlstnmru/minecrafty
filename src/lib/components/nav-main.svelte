<script lang="ts">
	import { page } from '$app/state';
	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';

	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { listInstances } from '#lib/instances.remote.js';
	import { isActive, type NavItem } from '#lib/nav.js';

	let { items }: { items: NavItem[] } = $props();

	const instances = listInstances();
</script>

<Sidebar.Group>
	<Sidebar.GroupContent class="flex flex-col gap-2">
		<Sidebar.Menu>
			{#each items as item (item.title)}
				{#if item.url === '/instances'}
					<Collapsible.Root open={isActive(item.url, page.url.pathname)} class="group/collapsible">
						{#snippet child({ props })}
							<Sidebar.MenuItem {...props}>
								<Sidebar.MenuButton
									tooltipContent={item.title}
									isActive={isActive(item.url, page.url.pathname)}
								>
									{#snippet child({ props })}
										<a href={item.url} {...props}>
											<item.icon />
											<span>{item.title}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
								{#if instances.current?.length}
									<Collapsible.Trigger>
										{#snippet child({ props })}
											<Sidebar.MenuAction
												{...props}
												class="data-[state=open]:rotate-90"
												aria-label="Toggle instances"
											>
												<ChevronRightIcon />
											</Sidebar.MenuAction>
										{/snippet}
									</Collapsible.Trigger>
									<Collapsible.Content>
										<Sidebar.MenuSub>
											{#each instances.current as instance (instance.id)}
												<Sidebar.MenuSubItem>
													<Sidebar.MenuSubButton
														isActive={isActive(`/instances/${instance.id}`, page.url.pathname)}
													>
														{#snippet child({ props })}
															<a href="/instances/{instance.id}" {...props}>
																<span
																	class="size-1.5 shrink-0 rounded-full {instance.state ===
																	'running'
																		? 'bg-success'
																		: 'bg-muted-foreground/40'}"
																></span>
																<span>{instance.name}</span>
															</a>
														{/snippet}
													</Sidebar.MenuSubButton>
												</Sidebar.MenuSubItem>
											{/each}
										</Sidebar.MenuSub>
									</Collapsible.Content>
								{/if}
							</Sidebar.MenuItem>
						{/snippet}
					</Collapsible.Root>
				{:else}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							tooltipContent={item.title}
							isActive={isActive(item.url, page.url.pathname)}
						>
							{#snippet child({ props })}
								<a href={item.url} {...props}>
									<item.icon />
									<span>{item.title}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/if}
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
