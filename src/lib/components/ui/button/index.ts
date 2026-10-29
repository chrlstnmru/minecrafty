import ButtonPrimitive, { buttonVariants } from './button.svelte';
import Root, {
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant
} from './extras-button.svelte';

// `Button` is the shadcn-svelte-extras button (loading state, onClickPromise),
// which wraps the stock shadcn-svelte button exported here as `ButtonPrimitive`.
export {
	Root,
	type ButtonProps as Props,
	//
	Root as Button,
	ButtonPrimitive,
	buttonVariants,
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant
};
