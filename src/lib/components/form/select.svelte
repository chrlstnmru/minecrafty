<script lang="ts" generics="T extends Option">
	import type { RemoteFormField } from '$app/server';

	import type { Option, OptionSnippet, SelectionSnippet } from '#lib/components/option.js';

	import Combobox from '#lib/components/combobox.svelte';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import * as Field from '#lib/components/ui/field/index.js';

	import { tryGetFieldRevalidateContext } from './context.js';

	type Props = {
		field: RemoteFormField<string>;
		label?: string;
		description?: string;
		disabled?: boolean;
		options?: T[];
		/** how a row looks, in the list and in the trigger; the label by default */
		option?: OptionSnippet<T>;
		/** how the trigger shows the chosen option, when it should differ from a row */
		selection?: SelectionSnippet<T>;
		placeholder?: string;
		/** a search box, for lists too long to scroll */
		searchable?: boolean;
	};

	let {
		field,
		label,
		description,
		disabled = false,
		options = [],
		option,
		selection,
		placeholder,
		searchable = false
	}: Props = $props();

	const id = $props.id();
	const revalidate = tryGetFieldRevalidateContext();
	const name = $derived(field.as('select').name);
</script>

<Field.Field data-invalid={!!field.issues()?.length}>
	{#if label}<Field.Label for={id}>{label}</Field.Label>{/if}
	<!-- the submitted value is this input's; the select only edits the field -->
	<input type="hidden" {name} value={field.value() ?? ''} />
	{#if searchable}
		<Combobox
			{id}
			{disabled}
			{options}
			{option}
			{selection}
			{placeholder}
			value={field.value() ?? ''}
			aria-invalid={!!field.issues()?.length}
			onValueChange={(next) => {
				field.set(next);
				if (field.dirty()) revalidate?.();
			}}
		/>
	{:else}
		<SelectMenu
			{id}
			{disabled}
			{options}
			{option}
			{selection}
			{placeholder}
			value={field.value() ?? ''}
			aria-invalid={!!field.issues()?.length}
			onValueChange={(next) => {
				field.set(next);
				if (field.dirty()) revalidate?.();
			}}
		/>
	{/if}
	{#if description}<Field.Description>{description}</Field.Description>{/if}
	<Field.Error errors={field.issues()} />
</Field.Field>
