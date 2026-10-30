<script lang="ts">
	import type { RemoteFormField } from '$app/server';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import { tryGetFieldRevalidateContext } from './context.js';

	type Props = {
		field: RemoteFormField<string>;
		label?: string;
		description?: string;
		disabled?: boolean;
		options?: { value: string; label: string }[];
		placeholder?: string;
	};

	let { field, label, description, disabled = false, options = [], placeholder }: Props = $props();

	const id = $props.id();
	const revalidate = tryGetFieldRevalidateContext();
	const name = $derived(field.as('select').name);
</script>

<Field.Field data-invalid={!!field.issues()?.length}>
	{#if label}<Field.Label for={id}>{label}</Field.Label>{/if}
	<!-- the submitted value is this input's; the select only edits the field -->
	<input type="hidden" {name} value={field.value() ?? ''} />
	<SelectMenu
		{id}
		{disabled}
		{options}
		{placeholder}
		value={field.value() ?? ''}
		aria-invalid={!!field.issues()?.length}
		onValueChange={(next) => {
			field.set(next);
			if (field.dirty()) revalidate?.();
		}}
	/>
	{#if description}<Field.Description>{description}</Field.Description>{/if}
	<Field.Error errors={field.issues()} />
</Field.Field>
