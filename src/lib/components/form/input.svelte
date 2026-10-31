<script lang="ts">
	import type { RemoteFormField } from '$app/server';
	import type { ComponentProps } from 'svelte';

	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';

	import { tryGetFieldRevalidateContext } from './context.js';

	/** Input types whose `.as()` only takes `[type, value?]`: not hidden/submit/checkbox/radio/file/select. */
	type SimpleInputType =
		| 'text'
		| 'email'
		| 'password'
		| 'search'
		| 'tel'
		| 'url'
		| 'date'
		| 'time'
		| 'number';

	type Props = Omit<ComponentProps<typeof Input>, 'value' | 'name' | 'type'> & {
		field: RemoteFormField<string> | RemoteFormField<number>;
		label?: string;
		description?: string;
		type?: SimpleInputType;
	};

	let { class: className, label, description, field, type = 'text', ...rest }: Props = $props();

	const id = $props.id();

	// `.as()` is overloaded per input type and `<Input>`'s props are a union keyed on a literal
	// `type`; neither can be satisfied by a type only known to be *some* SimpleInputType.
	// oxlint-disable-next-line typescript/no-explicit-any
	const fieldProps = $derived((field as any).as(type) as Record<string, unknown>);

	// Revalidates on input, once dirty and only inside a Form.Root (which already no-ops until
	// the first submit).
	const revalidate = tryGetFieldRevalidateContext();

	function handleInput() {
		if (field.dirty()) revalidate?.();
	}
</script>

<Field.Field data-invalid={!!field.issues()?.length}>
	{#if label}<Field.Label for={id}>{label}</Field.Label>{/if}
	<!-- oxlint-disable-next-line typescript/no-explicit-any -->
	<Input {id} class={className} {...fieldProps as any} oninput={handleInput} {...rest} />
	{#if description}<Field.Description>{description}</Field.Description>{/if}
	<Field.Error errors={field.issues()} />
</Field.Field>
