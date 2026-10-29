<script
	lang="ts"
	generics="
		// oxlint-disable-next-line typescript/no-explicit-any
		TSchema extends v.GenericSchema<any, any>,
		TRemoteForm extends RemoteForm<v.InferInput<TSchema>, unknown>,
	"
>
	import type { RemoteForm } from '$app/server';
	import type { Snippet } from 'svelte';
	import type { HTMLFormAttributes } from 'svelte/elements';
	import * as v from 'valibot';
	import { setFieldRevalidateContext } from './context.js';
	import { createValidator } from './validator.js';

	type Props = Omit<HTMLFormAttributes, 'method' | 'action' | 'children'> & {
		/** Backs client-side validation. Keep it in a plain module shared with the `form(...)`
		 * definition: a `.remote.ts` file cannot export a schema. */
		schema: TSchema;
		/** The remote form instance (from `form(...)` in a `*.remote.ts` file). */
		remoteFunction: TRemoteForm;
		/** Called once `.submit()` resolves, with whether it succeeded: for toasts, closing a
		 * sheet, redirects, resetting local state. */
		onSubmitted?: (succeeded: boolean) => void;
		children: Snippet<[{ attempted: boolean; pending: number }]>;
	};

	let { schema, remoteFunction, onSubmitted, children, ...rest }: Props = $props();

	$effect(() => {
		remoteFunction.preflight(schema);
	});

	// has the form actually been submitted; until then fields stay quiet while being typed in
	const attempted = $derived(remoteFunction.submitted);

	const validator = createValidator(() => remoteFunction);

	function revalidate() {
		if (attempted) validator.validate();
	}

	setFieldRevalidateContext(revalidate);
</script>

<form
	{...remoteFunction.enhance(async (form) => {
		validator.markServerSubmitted();
		// not `onSubmitted?.(await form.submit())`: that never evaluates the argument when the
		// callback is omitted, so the form would never be submitted
		const succeeded = await form.submit();
		onSubmitted?.(succeeded);
	})}
	{...rest}
>
	{@render children({ attempted, pending: remoteFunction.pending })}
</form>
