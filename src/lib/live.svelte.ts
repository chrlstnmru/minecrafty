// What pages keep current while they are open. Instance rows come from queries, refetched when
// the `revs` feed shows a newer `rev`; the numbers that change every few seconds come from feeds.

import type { RemoteQuery } from '$app/server';

import { panelFeed } from '#lib/realtime/feed.svelte.js';
import { statsNow } from '#lib/stats.remote.js';

/** The host's and each server's numbers, as the user may see them. */
export function liveStats() {
	const feed = panelFeed('stats');
	const first = statsNow();
	return {
		get current() {
			return feed.current ?? first.current;
		}
	};
}

type Tagged = { id: number; rev: string };

function follow<T>(
	query: () => RemoteQuery<T>,
	stale: (revs: Record<string, string>, value: T) => boolean
) {
	const revs = panelFeed('revs');
	$effect(() => {
		const q = query();
		const now = revs.current;
		const value = q.current;
		if (now && value && stale(now, value)) void q.refresh();
	});
}

/** Refetches a query of instance rows when one of them changed, or one appeared or went away. */
export function followInstances<T extends Tagged>(query: () => RemoteQuery<T[]>) {
	follow(
		query,
		(revs, rows) =>
			rows.length !== Object.keys(revs).length || rows.some((r) => revs[r.id] !== r.rev)
	);
}

/**
 * Refetches one instance's query when it changed. One gone from the feed (deleted, or no longer
 * visible) is not refetched: that would fail, and the page is about to leave it.
 */
export function followInstance<T extends Tagged>(query: () => RemoteQuery<T>) {
	follow(query, (revs, row) => row.id in revs && revs[row.id] !== row.rev);
}

/** The running job's progress on each instance, by id. Read it only while one is installing. */
export const liveProgress = () => panelFeed('progress');
