import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Run with Bun (`bun run test`): the server code uses bun:sqlite and Bun.* APIs.
export default defineConfig({
	resolve: { alias: { '#lib': fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	test: {
		include: ['src/**/*.test.ts'],
		setupFiles: ['./vitest.setup.ts'],
		testTimeout: 30_000
	}
});
