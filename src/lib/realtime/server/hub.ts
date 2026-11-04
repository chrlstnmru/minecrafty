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
	type ServerMessage
} from '#lib/realtime/protocol.js';
import { idSchema } from '#lib/schemas/common.js';
import { check } from '#lib/server/access.js';
import * as live from '#lib/server/live-server.js';
import { followLog } from '#lib/server/logs.js';
import { sessionToken, userFromToken } from '#lib/server/sessions.js';
import { sleep } from '#lib/sleep.js';

export type Socket = {
	send(text: string): void;
	/** bytes queued and not yet sent */
	buffered(): number;
	close(code: number, reason: string): void;
};

type Feed<F extends FeedName> = {
	permission: InstancePermission;
	open(instanceId: number, signal: AbortSignal): AsyncIterable<FeedFrames[F]>;
};

const feeds: { [F in FeedName]: Feed<F> } = {
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

const messageSchema = v.variant('type', [
	v.object({
		type: v.literal('subscribe'),
		sub: v.pipe(v.number(), v.integer(), v.minValue(0)),
		feed: v.picklist(Object.keys(feeds) as FeedName[]),
		instance: idSchema
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

type Running = { feed: FeedName; instance: number; stop: AbortController };

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

	#refusal(user: NonNullable<ReturnType<typeof userFromToken>>, feed: FeedName, instance: number) {
		const result = check(user, instance, feeds[feed].permission);
		if (result === 'unknown') return { status: 404, message: 'Instance not found' };
		if (result === 'denied')
			return { status: 403, message: 'You do not have permission to see this' };
		return null;
	}

	#start(sub: number, feed: FeedName, instance: number) {
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
		void this.#pump(sub, feeds[feed].open(instance, stop.signal), stop.signal);
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
