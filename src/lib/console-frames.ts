// The live console's protocol, both ends: the server turns a runner's messages into frames, and
// the page merges frames into lines. A live query only keeps its latest value, so a frame can be
// skipped; every frame repeats the most recent lines, and the page drops the ones it has seen.

import type { RunnerState, ServerMessage } from '#runner/protocol.js';

type ConsoleLine = { seq: number; line: string };

export type ConsoleFrame = {
	state: 'stopped' | RunnerState;
	/** identifies one runner process; sequence numbers restart when it changes */
	run: number | null;
	/** recent lines, overlapping with earlier frames so a skipped frame loses nothing */
	lines: ConsoleLine[];
};

/** How many earlier lines each frame repeats. */
export const OVERLAP_LINES = 200;

type Subscription = { nextBatch(): Promise<ServerMessage[] | null>; close(): void };

/**
 * The frames of one instance's console until `signal` aborts. `subscribe` reaches its runner (null
 * when there is none yet, or it has exited); `sleep` waits before looking again and should return
 * early once `signal` aborts.
 */
export async function* framesFrom(
	subscribe: (resume: { after: number; run?: number }) => Promise<Subscription | null>,
	sleep: (ms: number) => Promise<unknown>,
	signal?: AbortSignal
): AsyncGenerator<ConsoleFrame> {
	let state: ConsoleFrame['state'] = 'stopped';
	let run: number | null = null;
	let after = 0;
	let tail: ConsoleLine[] = [];

	yield { state, run, lines: tail };

	// the runner may not exist yet (or exit and be replaced), so keep looking for one
	while (!signal?.aborted) {
		const sub = await subscribe({ after, run: run ?? undefined });
		if (signal?.aborted) {
			sub?.close();
			return;
		}
		if (!sub) {
			if (state !== 'stopped') {
				state = 'stopped';
				yield { state, run, lines: tail };
			}
			await sleep(1000);
			continue;
		}
		// a quiet server sends nothing, so a stop must end the wait for the next batch
		const stop = () => sub.close();
		signal?.addEventListener('abort', stop, { once: true });
		try {
			let batch;
			while ((batch = await sub.nextBatch()) && !signal?.aborted) {
				const fresh: ConsoleLine[] = [];
				for (const msg of batch) {
					if (msg.type === 'log') {
						fresh.push({ seq: msg.seq, line: msg.line });
						after = msg.seq;
					} else {
						state = msg.state;
						if (msg.startedAt !== run) {
							run = msg.startedAt;
							tail = [];
						}
					}
				}
				tail = [...tail, ...fresh].slice(-OVERLAP_LINES - fresh.length);
				yield { state, run, lines: tail };
				tail = tail.slice(-OVERLAP_LINES);
			}
		} finally {
			signal?.removeEventListener('abort', stop);
			sub.close();
		}
	}
}

export type ConsoleRow = { key: number; text: string; marker?: boolean };

/** Where the page is in the stream; start each view with a fresh one. */
export type MergeState = { lastRun: number | null; lastSeq: number; nextKey: number };

export const freshMerge = (): MergeState => ({ lastRun: null, lastSeq: 0, nextKey: 0 });

// oxlint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * The rows a frame adds to what the page shows: lines it has not seen, without colour codes, and
 * a marker where the server restarted or where lines were skipped.
 */
export function mergeFrame(state: MergeState, frame: ConsoleFrame): ConsoleRow[] {
	const add: ConsoleRow[] = [];
	if (frame.run !== null && frame.run !== state.lastRun) {
		if (state.lastRun !== null)
			add.push({ key: state.nextKey++, text: '— server restarted —', marker: true });
		state.lastRun = frame.run;
		state.lastSeq = 0;
	}
	for (const { seq, line } of frame.lines) {
		if (seq <= state.lastSeq) continue;
		if (state.lastSeq > 0 && seq > state.lastSeq + 1)
			add.push({ key: state.nextKey++, text: '— some output was skipped —', marker: true });
		state.lastSeq = seq;
		add.push({ key: state.nextKey++, text: line.replace(ANSI, '') });
	}
	return add;
}
