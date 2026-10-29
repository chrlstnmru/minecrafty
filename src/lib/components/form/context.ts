import { getContext, setContext } from 'svelte';

const KEY = Symbol('form-field-revalidate');

/** The contract a form manager (`Form.Root`) publishes so `Form.*` field components can
 * revalidate on input without `revalidate` being threaded through props. */
export function setFieldRevalidateContext(revalidate: () => void) {
	setContext(KEY, revalidate);
}

export function tryGetFieldRevalidateContext(): (() => void) | undefined {
	return getContext<(() => void) | undefined>(KEY);
}
