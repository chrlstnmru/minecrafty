import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientMessage, RunnerStatus, ServerMessage } from '#runner/protocol.js';
import { socketPath } from '#runner/protocol.js';

type Handler = (msg: ServerMessage) => void;

/** Opens a connection to the instance's runner; null when no runner is listening. */
async function connect(dir: string, id: number, onMessage: Handler, onClose?: () => void) {
	let buf = '';
	try {
		return await Bun.connect({
			unix: socketPath(dir, id),
			socket: {
				data(_s, chunk) {
					buf += chunk.toString();
					const lines = buf.split('\n');
					buf = lines.pop() ?? '';
					for (const line of lines) if (line) onMessage(JSON.parse(line));
				},
				close: onClose,
				error() {}
			}
		});
	} catch {
		// a leftover pid file without a listening socket means the runner died
		rmSync(join(dir, 'runner.pid'), { force: true });
		return null;
	}
}

/** Fire-and-forget command to a live runner. Returns false if none is running. */
export async function send(dir: string, id: number, msg: ClientMessage) {
	const socket = await connect(dir, id, () => {});
	if (!socket) return false;
	socket.write(JSON.stringify(msg) + '\n');
	socket.flush();
	socket.end();
	return true;
}

/** Current runner status, or null when the instance has no runner. */
export async function status(dir: string, id: number): Promise<RunnerStatus | null> {
	if (!existsSync(join(dir, 'runner.pid'))) return null;
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), 2000);
		connect(dir, id, (msg) => {
			if (msg.type !== 'status') return;
			clearTimeout(timer);
			resolve(msg);
		}).then((socket) => {
			if (!socket) return resolve(null);
			socket.write(JSON.stringify({ type: 'status' } satisfies ClientMessage) + '\n');
			socket.flush();
			setTimeout(() => socket.end(), 100);
		});
	});
}

export type Subscription = {
	/**
	 * Waits for output, gives a burst a moment to arrive, then returns it all at once.
	 * Returns null once the runner has closed the connection and everything was read.
	 */
	nextBatch(coalesceMs?: number): Promise<ServerMessage[] | null>;
	close(): void;
};

/** Streams console output and status from a live runner. Null when no runner is listening. */
export async function subscribe(
	dir: string,
	id: number,
	resume: { after?: number; run?: number } = {}
): Promise<Subscription | null> {
	const queue: ServerMessage[] = [];
	let closed = false;
	let wake: (() => void) | null = null;
	const notify = () => wake?.();

	const socket = await connect(
		dir,
		id,
		(msg) => {
			queue.push(msg);
			notify();
		},
		() => {
			closed = true;
			notify();
		}
	);
	if (!socket) return null;
	socket.write(JSON.stringify({ type: 'subscribe', ...resume } satisfies ClientMessage) + '\n');
	socket.flush();

	return {
		async nextBatch(coalesceMs = 100) {
			while (!queue.length) {
				if (closed) return null;
				await new Promise<void>((resolve) => (wake = resolve));
				wake = null;
			}
			await Bun.sleep(coalesceMs);
			return queue.splice(0);
		},
		close() {
			closed = true;
			socket.end();
			notify();
		}
	};
}
