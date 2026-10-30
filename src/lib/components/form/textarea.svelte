<script lang="ts">
	import type { RemoteFormField } from '$app/server';
	import type { ComponentProps } from 'svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { tryGetFieldRevalidateContext } from './context.js';

	type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'name'> & {
		field: RemoteFormField<string>;
		label?: string;
		description?: string;
	};

	let { class: className, label, description, field, ...rest }: Props = $props();

	const id = $props.id();
	const revalidate = tryGetFieldRevalidateContext();

	function handleInput() {
		if (field.dirty()) revalidate?.();
	}
</script>

<Field.Field data-invalid={!!field.issues()?.length}>
	{#if label}<Field.Label for={id}>{label}</Field.Label>{/if}
	<Textarea {id} class={className} {...field.as('text')} oninput={handleInput} {...rest} />
	{#if description}<Field.Description>{description}</Field.Description>{/if}
	<Field.Error errors={field.issues()} />
</Field.Field>
