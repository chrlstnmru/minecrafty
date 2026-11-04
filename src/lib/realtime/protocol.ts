// The live feeds' socket protocol, both ends. One socket per tab carries every feed the tab shows;
// each subscription has an id the page picks, and frames come back tagged with it.

import type { ConsoleFrame } from '#lib/console-frames.js';
import type { LogFrame } from '#lib/server/logs.js';

export const SOCKET_PATH = '/_ws';

export type FeedFrames = { console: ConsoleFrame; log: LogFrame };
export type FeedName = keyof FeedFrames;

export type ClientMessage =
	| { type: 'subscribe'; sub: number; feed: FeedName; instance: number }
	| { type: 'unsubscribe'; sub: number };

export type FeedError = { status: number; message: string };

export type ServerMessage =
	| { type: 'frame'; sub: number; frame: FeedFrames[FeedName] }
	| ({ type: 'error'; sub: number } & FeedError);

/** Close codes: the session ended (sign in again), or the socket broke the protocol. */
export const CLOSE_SIGNED_OUT = 4401;
export const CLOSE_BAD_MESSAGE = 4400;
