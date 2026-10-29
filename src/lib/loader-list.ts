// Plain data (no server imports) so both the server and the forms' client-side schemas can use it.
export const LOADERS = [
	'vanilla',
	'paper',
	'purpur',
	'fabric',
	'quilt',
	'forge',
	'neoforge'
] as const;
export type Loader = (typeof LOADERS)[number];
