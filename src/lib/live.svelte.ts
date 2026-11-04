// What every page shows, kept current: the first value comes from a query (so the server-rendered
// page has it), and the tab's socket feed takes over once its first frame arrives.

import { listInstances } from '#lib/instances.remote.js';
import { panelFeed } from '#lib/realtime/feed.svelte.js';
import { statsNow } from '#lib/stats.remote.js';

function live<T>(feed: { current: T | undefined }, first: { current: T | undefined }) {
	return {
		get current() {
			return feed.current ?? first.current;
		}
	};
}

/** The instances the user may see, each with what they may do on it. */
export const liveInstances = () => live(panelFeed('instances'), listInstances());

/** The host's and each server's numbers, as the user may see them. */
export const liveStats = () => live(panelFeed('stats'), statsNow());
