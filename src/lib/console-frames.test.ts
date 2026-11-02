import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '#runner/protocol.js';

import {
	framesFrom,
	freshMerge,
	mergeFrame,
	OVERLAP_LINES,
	type ConsoleFrame
} from './console-frames';

const status = (startedAt: number, state: 'running' | 'exited' = 'running'): ServerMessage => ({
	type: 'status',
	state,
	pid: 1,
	startedAt,
	exitCode: null
});
const logs = (from: number, to: number): ServerMessage[] =>
	Array.from({ length: to - from + 1 }, (_, i) => ({
		type: 'log',
		seq: from + i,
		line: `line ${from + i}`
	}));

/**
 * A runner that answers each subscription with the next script: a list of batches, then its end;
 * null for no runner at all.
 */
function runner(scripts: (ServerMessage[][] | null)[]) {
	const resumes: { after: number; run?: number }[] = [];
	const subscribe = vi.fn(async (resume: { after: number; run?: number }) => {
		resumes.push(resume);
		const script = scripts.shift();
		if (!script) return null;
		const batches = [...script];
		return { nextBatch: async () => batches.shift() ?? null, close: vi.fn() };
	});
	return { subscribe, resumes };
}

/** The first `count` frames. */
async function take(frames: AsyncGenerator<ConsoleFrame>, count: number) {
	const taken: ConsoleFrame[] = [];
	for await (const frame of frames) {
		taken.push(structuredClone(frame));
		if (taken.length === count) break;
	}
	return taken;
}

/** What the page shows after merging these frames. */
function shown(frames: ConsoleFrame[]) {
	const state = freshMerge();
	return frames.flatMap((frame) => mergeFrame(state, frame)).map((row) => row.text);
}

const sleep = async () => {};

describe('the console stream', () => {
	it('loses no line when a frame is skipped, since frames overlap', async () => {
		const { subscribe } = runner([[[status(7), ...logs(1, 3)], logs(4, 6), logs(7, 9)]]);
		const frames = await take(framesFrom(subscribe, sleep), 4);
		expect(frames[0]).toEqual({ state: 'stopped', run: null, lines: [] });

		const lines = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`);
		expect(shown(frames)).toEqual(lines);
		// the page only got the first and the last of the runner's frames
		expect(shown([frames[1], frames[3]])).toEqual(lines);
	});

	it('starts a fresh console for a new run, and marks the restart', async () => {
		const { subscribe, resumes } = runner([
			[[status(1), ...logs(1, 2)]],
			[[status(2), ...logs(1, 1)]]
		]);
		const frames = await take(framesFrom(subscribe, sleep), 3);
		expect(frames[2].lines).toEqual([{ seq: 1, line: 'line 1' }]);
		expect(shown(frames)).toEqual(['line 1', 'line 2', '— server restarted —', 'line 1']);
		// it asks the runner for what came after the last line of the run it knows
		expect(resumes[1]).toEqual({ after: 2, run: 1 });
	});

	it('marks lines that fell out of the overlap as skipped', () => {
		const state = freshMerge();
		mergeFrame(state, { state: 'running', run: 1, lines: [{ seq: 1, line: 'a' }] });
		const later = mergeFrame(state, {
			state: 'running',
			run: 1,
			lines: [{ seq: OVERLAP_LINES + 5, line: 'b' }]
		});
		expect(later.map((row) => row.text)).toEqual(['— some output was skipped —', 'b']);
	});

	it('reports stopped once, and keeps looking for a runner', async () => {
		const wait = vi.fn(async () => {});
		const { subscribe } = runner([[[status(1), ...logs(1, 1)]], null, null, [[status(2)]]]);
		const frames = await take(framesFrom(subscribe, wait), 4);
		expect(frames.map((frame) => frame.state)).toEqual([
			'stopped',
			'running',
			'stopped',
			'running'
		]);
		expect(wait).toHaveBeenCalledTimes(2);
	});

	it('drops colour codes from the lines it shows', () => {
		const rows = mergeFrame(freshMerge(), {
			state: 'running',
			run: 1,
			lines: [{ seq: 1, line: '\u001b[32mDone\u001b[0m (3.2s)!' }]
		});
		expect(rows[0].text).toBe('Done (3.2s)!');
	});
});
