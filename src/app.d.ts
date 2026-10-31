// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** The release tag this build came from, set at build time (see vite.config.ts); empty otherwise. */
	const __MINECRAFTY_VERSION__: string | undefined;

	namespace App {
		// interface Error {}
		interface Locals {
			user: import('#lib/server/auth.js').SessionUser | null;
		}
		// interface PageData {}
		interface PageState {
			/** the roles page, on a narrow screen: the details of one role are open */
			roleDetail?: boolean;
		}
		// interface Platform {}
	}
}

export {};
