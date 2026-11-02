/**
 * Runs tests through Vite's client transform, so `.svelte.ts` modules compile for the browser and
 * `$effect` runs. There is no DOM: modules under test must not need one.
 */
export default {
	name: 'svelte-client',
	viteEnvironment: 'client',
	setup: () => ({ teardown() {} })
};
