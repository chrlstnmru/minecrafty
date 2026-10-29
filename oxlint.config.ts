import { defineConfig } from 'oxlint';

export default defineConfig({
	plugins: ['typescript'],
	categories: { correctness: 'error' },
	rules: {
		'no-unused-vars': [
			'error',
			{
				args: 'all',
				argsIgnorePattern: '^_',
				caughtErrors: 'all',
				caughtErrorsIgnorePattern: '^_',
				destructuredArrayIgnorePattern: '^_',
				varsIgnorePattern: '^_',
				ignoreRestSiblings: true
			}
		]
	},
	ignorePatterns: ['build', '.svelte-kit', 'data', 'drizzle']
});
