<script lang="ts">
	import type { RemoteFormField } from '$app/server';
	import type { Snippet } from 'svelte';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { tryGetFieldRevalidateContext } from './context.js';

	type Props = {
		field: RemoteFormField<boolean>;
		label?: string;
		description?: string;
		/** label content when it is more than text (a link, say); replaces `label` */
		children?: Snippet;
	};

	// no error text on purpose: an unticked required box is shown by its red invalid state
	let { field, label, description, children }: Props = $props();

	const id = $props.id();
	const revalidate = tryGetFieldRevalidateContext();

	// `type="checkbox"` is for native inputs; on the shadcn checkbox (a button) it would make it submit
	const attrs = $derived.by(() => {
		const { name, checked, 'aria-invalid': invalid } = field.as('checkbox');
		return { name, checked, 'aria-invalid': invalid };
	});
</script>

<Field.Field orientation="horizontal" data-invalid={!!field.issues()?.length}>
	<Checkbox
		{id}
		{...attrs}
		onCheckedChange={(checked) => {
			field.set(checked);
			revalidate?.();
		}}
	/>
	<Field.Content>
		<Field.Label for={id} class="font-normal">
			{#if children}{@render children()}{:else}{label}{/if}
		</Field.Label>
		{#if description}<Field.Description>{description}</Field.Description>{/if}
	</Field.Content>
</Field.Field>
