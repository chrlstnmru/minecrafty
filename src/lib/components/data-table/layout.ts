import { createContext } from 'svelte';

/** Which of Content's two renderings a row is in: the table, or stacked rows for narrow containers. */
export type Layout = 'table' | 'stacked';

export const [getLayout, setLayout] = createContext<Layout>();
