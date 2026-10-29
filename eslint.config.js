import prettier from 'eslint-config-prettier';
import oxlint from 'eslint-plugin-oxlint';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		// oxlint reads the same disable comments, so eslint can't tell when they're still needed
		linterOptions: { reportUnusedDisableDirectives: 'off' },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				// no type-aware rules are enabled, and building the TS program for every
				// .svelte file is what made eslint take ~45s instead of ~2s
				projectService: false,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {
			'svelte/no-navigation-without-resolve': 'off',
			// covered by oxlint (see oxlint.config.ts), which also handles the `_` ignore patterns
			'@typescript-eslint/no-unused-vars': 'off'
		}
	},
	// must stay last: disables the ESLint rules that oxlint already runs
	...(await oxlint.buildFromConfigFile('./oxlint.config.ts'))
);
