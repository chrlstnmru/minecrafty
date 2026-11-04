import type { RemoteQuery } from '$app/server';

import { browser } from '$app/env';

/**
 * For `$derived(await rendered(query))`, so a page both renders on the server and shows a skeleton
 * when navigated to. The server waits for the query (its `.current` is always undefined). The
 * browser reads `.current` instead of waiting: it holds the server's value while hydrating, and is
 * undefined while a navigation loads it, so the page renders at once and shows its skeleton.
 */
export function rendered<T>(query: RemoteQuery<T>): T | undefined | Promise<T> {
	return browser ? query.current : Promise.resolve(query);
}
