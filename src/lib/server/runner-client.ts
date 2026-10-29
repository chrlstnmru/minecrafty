import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientMessage, RunnerStatus, ServerMessage } from '../../../runner/protocol';
import { socketPath } from '../../../runner/protocol';

type Handler = (msg: ServerMessage) => void;

/** Opens a connection to the instance's runner; null when no runner is listening. */
async function connect(dir: string, id: number, onMessage: Handler) {
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
