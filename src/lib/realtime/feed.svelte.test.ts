import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedSocket, LiveFeed } from './feed.svelte';
import { CLOSE_SIGNED_OUT, type ClientMessage, type ServerMessage } from './protocol';

/** A WebSocket the test opens, closes and answers by hand. */
class FakeSocket {
	readyState = 0;
	sent: ClientMessage[] = [];
	closedWith: number | null = null;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;

	send(text: string) {
		this.sent.push(JSON.parse(text));
	}
	close(code: number) {
		this.closedWith = code;
		this.readyState = 3;
	}
	accept() {
		this.readyState = 1;
		this.onopen?.();
	}
	drop(code = 1006) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
	push(msg: ServerMessage) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
}

let opened: FakeSocket[];
let sockets: FeedSocket;

const listener = () => ({
	feed: 'log' as const,
	instance: 1,
	frame: vi.fn(),
	error: vi.fn(),
	connected: vi.fn()
});

beforeEach(() => {
	vi.useFakeTimers();
	opened = [];
	sockets = new FeedSocket(() => {
		const socket = new FakeSocket();
		opened.push(socket);
		return socket as unknown as WebSocket;
	});
});

afterEach(() => vi.useRealTimers());

describe('FeedSocket', () => {
	it('opens one socket for every feed, and asks for each once it is open', () => {
		sockets.subscribe(listener());
		sockets.subscribe({ ...listener(), feed: 'console' });
		expect(opened).toHaveLength(1);
		opened[0].accept();
		expect(opened[0].sent).toEqual([
			{ type: 'subscribe', sub: 0, feed: 'log', instance: 1 },
			{ type: 'subscribe', sub: 1, feed: 'console', instance: 1 }
		]);
	});

	it('hands each frame to its own feed', () => {
		const log = listener();
		sockets.subscribe(log);
		opened[0].accept();
		const frame = { epoch: 0, total: 1, lines: [] };
		opened[0].push({ type: 'frame', sub: 0, frame });
		opened[0].push({ type: 'frame', sub: 7, frame });
		expect(log.frame).toHaveBeenCalledExactlyOnceWith(frame);
		expect(log.connected).toHaveBeenLastCalledWith(true);
	});

	it('connects again after a drop and asks for the same feeds', () => {
		const log = listener();
		sockets.subscribe(log);
		opened[0].accept();
		opened[0].drop();
		expect(log.connected).toHaveBeenLastCalledWith(false);
		vi.advanceTimersByTime(300);
		opened[1].accept();
		expect(opened[1].sent).toEqual([{ type: 'subscribe', sub: 0, feed: 'log', instance: 1 }]);
	});

	it('stops retrying once signed out, and says so', () => {
		const log = listener();
		sockets.subscribe(log);
		opened[0].accept();
		opened[0].drop(CLOSE_SIGNED_OUT);
		vi.advanceTimersByTime(60_000);
		expect(opened).toHaveLength(1);
		expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
	});

	it('does not ask again for a feed the server refused', () => {
		const log = listener();
		sockets.subscribe(log);
		opened[0].accept();
		opened[0].push({ type: 'error', sub: 0, status: 403, message: 'No' });
		expect(log.error).toHaveBeenCalledWith({ status: 403, message: 'No' });
		opened[0].drop();
		vi.advanceTimersByTime(60_000);
		expect(opened).toHaveLength(1);
	});

	it('unsubscribes at once, and closes the socket only after it sat unused for a while', () => {
		const stop = sockets.subscribe(listener());
		opened[0].accept();
		stop();
		expect(opened[0].sent.at(-1)).toEqual({ type: 'unsubscribe', sub: 0 });
		vi.advanceTimersByTime(5_000);
		sockets.subscribe(listener());
		vi.advanceTimersByTime(20_000);
		expect(opened[0].closedWith).toBeNull();
		expect(opened).toHaveLength(1);
	});

	it('closes an unused socket', () => {
		sockets.subscribe(listener())();
		opened[0].accept();
		vi.advanceTimersByTime(10_000);
		expect(opened[0].closedWith).toBe(1000);
	});
});

describe('LiveFeed', () => {
	it('runs while something reads it, and stops as soon as nothing does', () => {
		const feed = new LiveFeed('log', 4, () => sockets);
		expect(opened).toHaveLength(0);

		const seen: unknown[] = [];
		const destroy = $effect.root(() => {
			$effect(() => {
				seen.push(feed.current);
			});
		});
		flushSync();
		opened[0].accept();
		expect(opened[0].sent).toEqual([{ type: 'subscribe', sub: 0, feed: 'log', instance: 4 }]);

		opened[0].push({ type: 'frame', sub: 0, frame: { epoch: 0, total: 2, lines: [] } });
		flushSync();
		expect(seen.at(-1)).toEqual({ epoch: 0, total: 2, lines: [] });

		destroy();
		flushSync();
		expect(opened[0].sent.at(-1)).toEqual({ type: 'unsubscribe', sub: 0 });
	});
});
