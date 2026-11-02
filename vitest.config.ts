import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
	'#lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
	'#runner': fileURLToPath(new URL('./runner', import.meta.url)),
	'#test': fileURLToPath(new URL('./src/test', import.meta.url))
};

// Run with Bun (`bun run test`): the server code uses bun:sqlite and Bun.* APIs.
export default defineConfig({
	resolve: { alias },
	test: {
		testTimeout: 30_000,
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.svelte.test.ts'],
					setupFiles: ['./vitest.setup.ts']
				}
			},
			{
				extends: true,
				// runes compiled for the browser, where `$effect` runs (the server build of Svelte skips effects)
				plugins: [svelte({ compilerOptions: { runes: true } })],
				resolve: { conditions: ['browser'] },
				test: {
					name: 'client',
					environment: './src/test/client-environment.ts',
					include: ['src/**/*.svelte.test.ts']
				}
			}
		]
	}
});
