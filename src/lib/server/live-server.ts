import { eq } from 'drizzle-orm';
import type { RunnerStatus, ServerMessage } from '#runner/protocol.js';
import { instanceDir } from './config';
import { db } from './db';
import { instances } from './db/schema';
import { RconError } from './rcon';
import { rconCommand } from './rcon-sessions';
import * as runner from './runner-client';
import type { Subscription } from './runner-client';

// What the panel can do to an instance's running server, by instance id. The runner socket, the
// rule for "running", RCON and the waits on the server's own timing all stay behind this file.

/** The runner's report on the instance's server, or null when it has no runner. */
export const status = (id: number): Promise<RunnerStatus | null> =>
	runner.status(instanceDir(id), id);

/** Whether a server process is up (starting, running or stopping). */
export async function isRunning(id: number) {
	const live = await status(id);
	return !!live && live.state !== 'exited';
}

/** Types a line into the server's console. False when there is no runner to receive it. */
export const sendLine = (id: number, line: string) =>
	runner.send(instanceDir(id), id, { type: 'stdin', line });

export const stop = (id: number) => runner.send(instanceDir(id), id, { type: 'stop' });

export const kill = (id: number) => runner.send(instanceDir(id), id, { type: 'kill' });

/** Streams the console and status; null when no runner is listening. */
export const subscribe = (id: number, resume: { after?: number; run?: number } = {}) =>
	runner.subscribe(instanceDir(id), id, resume);

/** How long to wait for a server to stop; adjustable so tests need not wait. */
export const stopTiming = { timeoutMs: 3 * 60_000, pollMs: 500 };

/** Resolves true once the server has exited, false if it still runs after the timeout. */
export async function waitForExit(id: number) {
	const deadline = Date.now() + stopTiming.timeoutMs;
	for (;;) {
		const live = await status(id);
		if (!live || live.state === 'exited') return true;
		if (Date.now() >= deadline) return false;
		await Bun.sleep(stopTiming.pollMs);
	}
}

/** A failure with RCON, worded to show to the user. `no-rcon`: it was never switched on. */
export class LiveServerError extends Error {
	constructor(
		message: string,
		readonly kind: 'no-rcon' | 'rcon'
	) {
		super(message);
	}
}

function rconTarget(id: number) {
	const row = db
		.select({ port: instances.rconPort, password: instances.rconPassword })
		.from(instances)
		.where(eq(instances.id, id))
		.get();
	return row?.port && row.password ? { port: row.port, password: row.password } : null;
}

const rconProblem = (e: unknown) =>
	e instanceof RconError && (e.kind === 'refused' || e.kind === 'timeout')
		? 'RCON is not answering yet. It is switched on when the server starts, so a server that was already running needs a restart; a server that is still starting needs a moment.'
		: e instanceof Error
			? e.message
			: 'Could not reach the server';

/** Runs a command over the server's kept RCON connection and returns its reply. Throws a LiveServerError. */
export async function rcon(id: number, command: string, timeoutMs?: number) {
	const target = rconTarget(id);
	if (!target)
		throw new LiveServerError(
			'RCON is switched on the next time the server starts. Restart it first.',
			'no-rcon'
		);
	try {
		return await rconCommand(id, target, command, timeoutMs);
	} catch (e) {
		throw new LiveServerError(rconProblem(e), 'rcon');
	}
}

/** How long to wait on the server while pausing saves; adjustable so tests need not wait. */
export const saveTiming = { quietMs: 300, saveOffMs: 15_000, saveAllMs: 120_000 };

/** Whether the line is the server confirming something (it logs after "[Server thread/INFO]: "). */
const SAVE_OFF_DONE = /Automatic saving is now disabled|Saving is already turned off/;
const SAVE_ALL_DONE = /Saved the (game|world)/;

/** Reads a runner's log in order, so a line is matched once and none is dropped between waits. */
class LogWatcher {
	private pending: ReturnType<Subscription['nextBatch']> | null = null;
	private queue: ServerMessage[] = [];

	constructor(private sub: Subscription) {}

	/** One more message, or null after `ms` or when the runner closed. */
	private async next(ms: number) {
		if (!this.queue.length) {
			this.pending ??= this.sub.nextBatch(50);
			const batch = await Promise.race([
				this.pending,
				Bun.sleep(ms).then(() => 'timeout' as const)
			]);
			if (batch === 'timeout' || !batch) return batch === 'timeout' ? undefined : null;
			this.pending = null;
			this.queue.push(...batch);
		}
		return this.queue.shift();
	}

	/** Skips whatever is already logged (the replay of history), up to a quiet moment. */
	async settle(quietMs: number) {
		while (await this.next(quietMs)) continue;
	}

	/** True once a log line matching `pattern` arrives; false on timeout or when the runner ends. */
	async until(pattern: RegExp, timeoutMs: number) {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const msg = await this.next(Math.max(0, deadline - Date.now()));
			if (!msg) return false;
			if (msg.type === 'log' && pattern.test(msg.line)) return true;
		}
	}
}

/**
 * Runs `work` with the world's autosave paused and flushed to disk when the server is
 * running, so the files copied are consistent. Autosave is always switched back on.
 */
export async function withWorldSaved<T>(id: number, work: () => Promise<T>) {
	if (!(await isRunning(id))) return work();
	const sub = await subscribe(id);
	if (!sub) return work();

	const log = new LogWatcher(sub);
	try {
		// the replayed history can hold old confirmations; only what follows the commands counts
		await log.settle(saveTiming.quietMs);
		await sendLine(id, 'save-off');
		try {
			if (!(await log.until(SAVE_OFF_DONE, saveTiming.saveOffMs)))
				throw new Error('The server did not confirm it paused saving');
			await sendLine(id, 'save-all flush');
			if (!(await log.until(SAVE_ALL_DONE, saveTiming.saveAllMs)))
				throw new Error('The server did not finish saving the world');
			return await work();
		} finally {
			await sendLine(id, 'save-on');
		}
	} finally {
		sub.close();
	}
}
