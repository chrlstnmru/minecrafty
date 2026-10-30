import { enhancedImages } from '@sveltejs/enhanced-img';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// resizes and re-encodes the loader icons at build time
		enhancedImages(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},

			adapter: adapter({
				// uploads travel as small-file batches (32 MB) or 4 MB pieces; the adapter's default is 512 KB. Only signed-in users can send big
				// bodies (see hooks.server.ts). BODY_SIZE_LIMIT overrides this.
				serverOptions: { maxRequestBodySize: 64 * 1024 * 1024 }
			}),
			experimental: { remoteFunctions: true }
		})
	]
});
