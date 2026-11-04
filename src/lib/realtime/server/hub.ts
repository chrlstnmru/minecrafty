// One tab's socket on the server: who signed it in, and the feeds it follows. Knows nothing about
// Bun's WebSocket type, so tests drive it with a plain object.

import * as v from 'valibot';

import type { InstancePermission } from '#lib/permissions.js';

import { framesFrom } from '#lib/console-frames.js';
import {
	CLOSE_BAD_MESSAGE,
	CLOSE_SIGNED_OUT,
	type FeedFrames,
	type FeedName,
	type InstanceFeed,
	type PanelFeed,
	type ServerMessage
} from '#lib/realtime/protocol.js';
import { idSchema } from '#lib/schemas/common.js';
import { check } from '#lib/server/access.js';
import { visibleInstances } from '#lib/server/instances.js';
import * as live from '#lib/server/live-server.js';
import { followLog } from '#lib/server/logs.js';
import { sessionToken, userFromToken, type SessionUser } from '#lib/server/sessions.js';
import { statsFor } from '#lib/server/stats.js';
import { sleep } from '#lib/sleep.js';

export type Socket = {
	send(text: string): void;
	/** bytes queued and not yet sent */
	buffered(): number;
	close(code: number, reason: string): void;
};

type ForInstance<F extends InstanceFeed> = {
	permission: InstancePermission;
	open(instanceId: number, signal: AbortSignal): AsyncIterable<FeedFrames[F]>;
};

/** `user` is looked up again on every call, so a role change shows in the next frame. */
type ForPanel<F extends PanelFeed> = {
	open(user: () => SessionUser | null, signal: AbortSignal): AsyncIterable<FeedFrames[F]>;
};

const instanceFeeds: { [F in InstanceFeed]: ForInstance<F> } = {
	console: {
		permission: 'console',
		open: (id, signal) =>
			framesFrom(
				(resume) => live.subscribe(id, resume),
				(ms) => sleep(ms, signal),
				signal
			)
	},
	log: { permission: 'logs', open: (id, signal) => followLog(id, 500, signal) }
};

/** Yields `read(user)` every `ms`, skipping a value equal to the last one sent. */
async function* sample<T>(
	user: () => SessionUser | null,
	read: (user: SessionUser) => Promise<T>,
	ms: number,
	signal: AbortSignal
) {
	let last = '';
	while (!signal.aborted) {
		const who = user();
		if (!who) return;
		const value = await read(who);
		const json = JSON.stringify(value);
		if (json !== last) {
			last = json;
			yield value;
		}
		await sleep(ms, signal);
	}
}

// there is no event for "an instance changed", so both sample the panel's view of things
const panelFeeds: { [F in PanelFeed]: ForPanel<F> } = {
	instances: { open: (user, signal) => sample(user, visibleInstances, 1000, signal) },
	stats: { open: (user, signal) => sample(user, statsFor, 3000, signal) }
};

const isPanel = (feed: FeedName): feed is PanelFeed => feed in panelFeeds;

const messageSchema = v.variant('type', [
	v.object({
		type: v.literal('subscribe'),
		sub: v.pipe(v.number(), v.integer(), v.minValue(0)),
		feed: v.picklist([...Object.keys(instanceFeeds), ...Object.keys(panelFeeds)] as FeedName[]),
		instance: v.optional(idSchema)
	}),
	v.object({ type: v.literal('unsubscribe'), sub: v.pipe(v.number(), v.integer(), v.minValue(0)) })
]);

const MAX_FEEDS = 32;
/** A socket this far behind skips frames; every frame repeats recent lines, so the page catches up. */
const MAX_BUFFERED = 1024 * 1024;
const RECHECK_MS = 30_000;

/**
 * Whether a socket may open: only from the panel's own pages. Returns the session token to keep
 * with the socket, or the response that refuses it. A socket without a session still opens, then
 * closes with {@link CLOSE_SIGNED_OUT}: a refused upgrade reaches the page as a bare network error
 * it would keep retrying.
 */
export function admit(request: Request): { token: string } | Response {
	const origin = request.headers.get('origin');
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
	// a page on another site may open a socket here and the browser would send our cookie with it
	if (!origin || !host || !URL.canParse(origin) || new URL(origin).host !== host)
		return new Response('Cross-origin sockets are not allowed', { status: 403 });
	return { token: sessionToken(request.headers.get('cookie')) ?? '' };
}

type Running = { feed: FeedName; instance?: number; stop: AbortController };

/** The feeds of one socket. Call {@link SocketSession.close} when the socket closes. */
export class SocketSession {
	#running = new Map<number, Running>();
	#recheck: ReturnType<typeof setInterval>;

	constructor(
		private socket: Socket,
		private token: string,
		recheckMs = RECHECK_MS
	) {
		this.#recheck = setInterval(() => this.recheck(), recheckMs);
		this.recheck();
	}

	message(raw: string) {
		let parsed;
		try {
			parsed = v.safeParse(messageSchema, JSON.parse(raw));
		} catch {
			parsed = null;
		}
		if (!parsed?.success) return this.socket.close(CLOSE_BAD_MESSAGE, 'Bad message');
		const msg = parsed.output;
		if (msg.type === 'unsubscribe') return this.#stop(msg.sub);
		this.#start(msg.sub, msg.feed, msg.instance);
	}

	/** Ends the socket when its session is gone, and each feed its user may no longer see. */
	recheck() {
		const user = userFromToken(this.token);
		if (!user) {
			this.socket.close(CLOSE_SIGNED_OUT, 'Signed out');
			return this.close();
		}
		for (const [sub, { feed, instance }] of this.#running) {
			const refused = this.#refusal(user, feed, instance);
			if (refused) {
				this.#stop(sub);
				this.#send({ type: 'error', sub, ...refused });
			}
		}
	}

	close() {
		clearInterval(this.#recheck);
		for (const sub of [...this.#running.keys()]) this.#stop(sub);
	}

	#refusal(user: SessionUser, feed: FeedName, instance: number | undefined) {
		// a panel feed only shows what its user may see, so being signed in is enough
		if (isPanel(feed)) return null;
		if (instance === undefined) return { status: 400, message: 'This feed needs an instance' };
		const result = check(user, instance, instanceFeeds[feed].permission);
		if (result === 'unknown') return { status: 404, message: 'Instance not found' };
		if (result === 'denied')
			return { status: 403, message: 'You do not have permission to see this' };
		return null;
	}

	#start(sub: number, feed: FeedName, instance: number | undefined) {
		const user = userFromToken(this.token);
		if (!user) {
			this.socket.close(CLOSE_SIGNED_OUT, 'Signed out');
			return this.close();
		}
		this.#stop(sub);
		const refused =
			this.#running.size >= MAX_FEEDS
				? { status: 429, message: 'Too many live feeds open in this tab' }
				: this.#refusal(user, feed, instance);
		if (refused) return this.#send({ type: 'error', sub, ...refused });

		const stop = new AbortController();
		this.#running.set(sub, { feed, instance, stop });
		const frames = isPanel(feed)
			? panelFeeds[feed].open(() => userFromToken(this.token), stop.signal)
			: instanceFeeds[feed].open(instance!, stop.signal);
		void this.#pump(sub, frames as AsyncIterable<FeedFrames[FeedName]>, stop.signal);
	}

	async #pump(sub: number, frames: AsyncIterable<FeedFrames[FeedName]>, signal: AbortSignal) {
		try {
			for await (const frame of frames) {
				if (signal.aborted) break;
				if (this.socket.buffered() > MAX_BUFFERED) continue;
				this.#send({ type: 'frame', sub, frame });
			}
		} catch (e) {
			if (!signal.aborted) {
				console.error('live feed failed', e);
				this.#send({ type: 'error', sub, status: 500, message: 'The live feed stopped' });
			}
		} finally {
			if (this.#running.get(sub)?.stop.signal === signal) this.#running.delete(sub);
		}
	}

	#stop(sub: number) {
		this.#running.get(sub)?.stop.abort();
		this.#running.delete(sub);
	}

	#send(msg: ServerMessage) {
		try {
			this.socket.send(JSON.stringify(msg));
		} catch {
			// the socket closed while a frame was on its way; close() stops the feeds
		}
	}
}
