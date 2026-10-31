import { defineConfig } from 'oxfmt';

export default defineConfig({
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	sortImports: {
		groups: [
			'type-import',
			['value-builtin', 'value-external'],
			'type-internal',
			'value-internal',
			['type-parent', 'type-sibling', 'type-index'],
			['value-parent', 'value-sibling', 'value-index'],
			'unknown'
		]
	},
	sortTailwindcss: { stylesheet: './src/routes/layout.css' },
	svelte: {},
	associations: [{ files: ['*.svelte'], language: 'svelte' }],
	ignorePatterns: [
		'package-lock.json',
		'pnpm-lock.yaml',
		'yarn.lock',
		'bun.lock',
		'bun.lockb',
		'/static/',
		'drizzle/meta',
		'/build',
		'/.svelte-kit',
		'/data'
	]
});
