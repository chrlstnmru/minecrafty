<script lang="ts">
	import type { RemoteFormField } from '$app/server';
	import ExternalLink from '@tabler/icons-svelte/icons/external-link';
	import * as Form from '#lib/components/form/index.js';

	let { field }: { field: RemoteFormField<boolean> } = $props();
</script>

<Form.Checkbox {field}>
	I accept the
	<a
		href="https://www.minecraft.net/eula"
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex items-center gap-0.5 underline underline-offset-4 hover:text-foreground"
	>
		Minecraft EULA
		<ExternalLink class="inline size-5" />
	</a>
</Form.Checkbox>
