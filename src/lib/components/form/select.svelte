<script lang="ts">
	import type { RemoteFormField } from '$app/server';
	import type { Snippet } from 'svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
	import { tryGetFieldRevalidateContext } from './context.js';

	type Props = {
		field: RemoteFormField<string>;
		label?: string;
		description?: string;
		disabled?: boolean;
		options?: { value: string; label: string }[];
		/** options as markup instead, e.g. grouped or generated */
		children?: Snippet;
	};

	let { field, label, description, disabled = false, options = [], children }: Props = $props();

	const id = $props.id();
	const revalidate = tryGetFieldRevalidateContext();
</script>

<Field.Field data-invalid={!!field.issues()?.length}>
	{#if label}<Field.Label for={id}>{label}</Field.Label>{/if}
	<NativeSelect
		{id}
		{disabled}
		{...field.as('select')}
		onchange={() => {
			if (field.dirty()) revalidate?.();
		}}
	>
		{#if children}
			{@render children()}
		{:else}
			{#each options as option (option.value)}
				<NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>
			{/each}
		{/if}
	</NativeSelect>
	{#if description}<Field.Description>{description}</Field.Description>{/if}
	<Field.Error errors={field.issues()} />
</Field.Field>
