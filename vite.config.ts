import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},

			adapter: adapter({
				// file uploads; the adapter's default is 512 KB. Only signed-in users can send big
				// bodies (see hooks.server.ts). BODY_SIZE_LIMIT overrides this.
				serverOptions: { maxRequestBodySize: 600 * 1024 * 1024 }
			}),
			experimental: { remoteFunctions: true }
		})
	]
});
