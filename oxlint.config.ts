import { defineConfig } from 'oxlint';

export default defineConfig({
	plugins: ['typescript'],
	categories: { correctness: 'error' },
	rules: {
		// parity with typescript-eslint's recommended set, which oxlint's default category lacks
		'typescript/ban-ts-comment': 'error',
		'typescript/no-explicit-any': 'error',
		'typescript/no-namespace': 'error',
		'typescript/no-require-imports': 'error',
		'typescript/no-unsafe-function-type': 'error',
		'typescript/no-wrapper-object-types': 'error',
		'typescript/no-empty-object-type': 'error',
		'typescript/prefer-as-const': 'error',
		'typescript/triple-slash-reference': 'error',
		'no-var': 'error',
		'prefer-const': 'error',
		'prefer-rest-params': 'error',
		'prefer-spread': 'error',
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
