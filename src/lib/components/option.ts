import type { Snippet } from 'svelte';

/** An entry of a select or combobox. Extra fields travel along for the `option` snippet to use. */
export type Option = { value: string; label: string };

/** Custom content for a row of the list (and for the trigger, unless `selection` is given). */
export type OptionSnippet<T extends Option> = Snippet<[option: T, state: { selected: boolean }]>;

/** Custom content for the trigger, which shows the chosen option. */
export type SelectionSnippet<T extends Option> = Snippet<[option: T]>;
