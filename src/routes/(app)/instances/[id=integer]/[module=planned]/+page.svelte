<script lang="ts">
	import { page } from '$app/state';
	import { instanceModules } from '#lib/instance-modules.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';

	const module = $derived(instanceModules.find((m) => m.slug === page.params.module));
</script>

<svelte:head><title>{module?.title} · Minecrafty</title></svelte:head>

{#if module}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<module.icon class="size-5" />{module.title}
			</Card.Title>
			<Card.Description>{module.description}</Card.Description>
			<Card.Action><Badge variant="outline">Planned · M{module.planned}</Badge></Card.Action>
		</Card.Header>
	</Card.Root>
{/if}
