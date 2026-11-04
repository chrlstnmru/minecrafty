// The page end of the live feeds: one socket per tab, opened for the first feed and closed a little
// after the last one, so moving between tabs keeps it.

import { createSubscriber } from 'svelte/reactivity';

import {
	CLOSE_SIGNED_OUT,
	SOCKET_PATH,
	type ClientMessage,
	type FeedError,
	type FeedFrames,
	type FeedName,
	type PanelFeed,
	type ServerMessage
} from './protocol';

type Listener = {
	feed: FeedName;
	instance?: number;
	frame(frame: unknown): void;
	error(error: FeedError): void;
	connected(on: boolean): void;
};

const IDLE_CLOSE_MS = 10_000;

/** Owns the tab's socket: reconnects with backoff and subscribes every feed again after. */
export class FeedSocket {
	#socket: WebSocket | null = null;
	#listeners = new Map<number, Listener>();
	#nextSub = 0;
	#attempt = 0;
	#retry: ReturnType<typeof setTimeout> | null = null;
	#idle: ReturnType<typeof setTimeout> | null = null;

	constructor(private open: () => WebSocket) {}

	/** Starts a feed; the returned function stops it. */
	subscribe(listener: Listener): () => void {
		const sub = this.#nextSub++;
		this.#listeners.set(sub, listener);
		if (this.#idle) clearTimeout(this.#idle);
		this.#idle = null;
		if (this.#socket?.readyState === WebSocket.OPEN) this.#subscribeOne(sub, listener);
		else this.#connect();
		return () => {
			if (!this.#listeners.delete(sub)) return;
			this.#send({ type: 'unsubscribe', sub });
			if (!this.#listeners.size) this.#idle = setTimeout(() => this.#closeIdle(), IDLE_CLOSE_MS);
		};
	}

	#connect() {
		if (this.#socket || this.#retry) return;
		const socket = this.open();
		this.#socket = socket;
		socket.onopen = () => {
			this.#attempt = 0;
			for (const [sub, listener] of this.#listeners) this.#subscribeOne(sub, listener);
		};
		socket.onmessage = (event) => this.#receive(JSON.parse(String(event.data)) as ServerMessage);
		socket.onclose = (event) => {
			this.#socket = null;
			for (const listener of this.#listeners.values()) listener.connected(false);
			// signed out: no point retrying; a feed started after signing in again opens a new socket
			if (event.code === CLOSE_SIGNED_OUT) {
				for (const listener of this.#listeners.values()) listener.error(signedOut);
				this.#listeners.clear();
				return;
			}
			if (!this.#listeners.size) return;
			const delay = Math.min(250 * 2 ** this.#attempt++, 10_000);
			this.#retry = setTimeout(() => {
				this.#retry = null;
				if (this.#listeners.size) this.#connect();
			}, delay);
		};
	}

	#subscribeOne(sub: number, { feed, instance }: Listener) {
		this.#send({ type: 'subscribe', sub, feed, instance });
	}

	#receive(msg: ServerMessage) {
		const listener = this.#listeners.get(msg.sub);
		if (!listener) return;
		if (msg.type === 'frame') {
			listener.connected(true);
			listener.frame(msg.frame);
		} else {
			// the server ended this feed; it is not asked for again after a reconnect
			this.#listeners.delete(msg.sub);
			listener.connected(false);
			listener.error({ status: msg.status, message: msg.message });
		}
	}

	#send(msg: ClientMessage) {
		if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(msg));
	}

	#closeIdle() {
		this.#idle = null;
		if (this.#listeners.size) return;
		this.#socket?.close(1000, 'No feeds');
		this.#socket = null;
	}
}

const signedOut: FeedError = {
	status: 401,
	message: 'You were signed out. Sign in again to see live output.'
};

let shared: FeedSocket | null = null;

function socket() {
	shared ??= new FeedSocket(() => {
		const url = new URL(SOCKET_PATH, location.href);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		return new WebSocket(url);
	});
	return shared;
}

/**
 * A live feed. It runs while something reactive (a template, `$effect`, `$derived`) reads it,
 * and stops on the server as soon as nothing does. With `pauseHidden` it also stops while the tab
 * is in the background, and starts again when the tab is shown.
 */
export class LiveFeed<F extends FeedName> {
	#current = $state<FeedFrames[F] | undefined>();
	#error = $state<FeedError | null>(null);
	#connected = $state(false);
	#subscribe: () => void;

	constructor(
		feed: F,
		instance: number | undefined,
		sockets: () => FeedSocket = socket,
		{ pauseHidden = false } = {}
	) {
		const start = () =>
			sockets().subscribe({
				feed,
				instance,
				frame: (frame) => {
					this.#error = null;
					this.#current = frame as FeedFrames[F];
				},
				error: (error) => (this.#error = error),
				connected: (on) => (this.#connected = on)
			});
		this.#subscribe = createSubscriber(() => {
			if (!pauseHidden) return start();
			let stop: (() => void) | null = null;
			const follow = () => {
				if (document.hidden) {
					stop?.();
					stop = null;
				} else stop ??= start();
			};
			follow();
			document.addEventListener('visibilitychange', follow);
			return () => {
				document.removeEventListener('visibilitychange', follow);
				stop?.();
			};
		});
	}

	/** The latest frame; undefined until the first arrives. */
	get current() {
		this.#subscribe();
		return this.#current;
	}

	/** Why the feed stopped, when the server refused or ended it. */
	get error() {
		this.#subscribe();
		return this.#error;
	}

	get connected() {
		this.#subscribe();
		return this.#connected;
	}
}

/** A feed about one instance, such as its console or its log. */
export const liveFeed = <F extends Exclude<FeedName, PanelFeed>>(feed: F, instance: number) =>
	new LiveFeed(feed, instance);

const panel = new Map<PanelFeed, LiveFeed<PanelFeed>>();

/**
 * A feed about the whole panel. Every reader in the tab shares one subscription, and it pauses
 * while the tab is hidden.
 */
export function panelFeed<F extends PanelFeed>(feed: F): LiveFeed<F> {
	let shared = panel.get(feed);
	if (!shared) {
		shared = new LiveFeed(feed, undefined, socket, { pauseHidden: true });
		panel.set(feed, shared);
	}
	return shared as LiveFeed<F>;
}
