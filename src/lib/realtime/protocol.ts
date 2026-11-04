// The live feeds' socket protocol, both ends. One socket per tab carries every feed the tab shows;
// each subscription has an id the page picks, and frames come back tagged with it.

import type { ConsoleFrame } from '#lib/console-frames.js';
import type { VisibleInstance } from '#lib/server/instances.js';
import type { LogFrame } from '#lib/server/logs.js';
import type { Snapshot } from '#lib/server/stats.js';

export const SOCKET_PATH = '/_ws';

export type FeedFrames = {
	console: ConsoleFrame;
	log: LogFrame;
	instances: VisibleInstance[];
	/** the `rev` of `listNavInstances`; a new one means refetch it */
	nav: string;
	stats: Snapshot;
};
export type FeedName = keyof FeedFrames;

/** Feeds about the whole panel rather than one instance; they are subscribed without an instance. */
export const PANEL_FEEDS = ['instances', 'nav', 'stats'] as const satisfies readonly FeedName[];
export type PanelFeed = (typeof PANEL_FEEDS)[number];
export type InstanceFeed = Exclude<FeedName, PanelFeed>;

export type ClientMessage =
	| { type: 'subscribe'; sub: number; feed: FeedName; instance?: number }
	| { type: 'unsubscribe'; sub: number };

export type FeedError = { status: number; message: string };

export type ServerMessage =
	| { type: 'frame'; sub: number; frame: FeedFrames[FeedName] }
	| ({ type: 'error'; sub: number } & FeedError);

/** Close codes: the session ended (sign in again), or the socket broke the protocol. */
export const CLOSE_SIGNED_OUT = 4401;
export const CLOSE_BAD_MESSAGE = 4400;
