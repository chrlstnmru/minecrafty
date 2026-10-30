import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, RunnerStatus } from '#runner/protocol.js';
import { makeInstance } from '#test/instance.js';

// The runner is replaced: a test lists the states it reports, one per status check, the last repeating.
const fake = vi.hoisted(() => ({
	states: [] as (RunnerStatus['state'] | null)[],
	checks: 0,
	sent: [] as ClientMessage[]
}));

vi.mock('./runner-client', () => ({
	status: async () => {
		const state = fake.states[Math.min(fake.checks++, fake.states.length - 1)];
		return state ? { state, pid: 1, startedAt: 1, exitCode: null } : null;
	},
	send: async (_dir: string, _id: number, msg: ClientMessage) => {
		fake.sent.push(msg);
		return true;
	}
}));

const I = await import('./instances');

/** An instance whose start fails at once on the EULA, so reaching the start is visible without a JVM. */
function instance() {
	const row = makeInstance({ eulaAccepted: false });
	mkdirSync(I.serverDir(row.id), { recursive: true });
	writeFileSync(`${I.serverDir(row.id)}/server.jar`, '');
	return row.id;
}

beforeEach(() => {
	Object.assign(fake, { states: [], checks: 0, sent: [] });
	Object.assign(I.stopTiming, { timeoutMs: 200, pollMs: 5 });
});

describe('restartInstance', () => {
	it('waits for a slow stop to finish before starting again', async () => {
		fake.states = ['running', 'stopping', 'stopping', 'stopping', 'exited', null];
		await expect(I.restartInstance(instance())).rejects.toThrow(/EULA/);
		expect(fake.sent).toEqual([{ type: 'stop' }]);
		// the start was only tried after the runner reported the exit
		expect(fake.checks).toBeGreaterThanOrEqual(5);
	});

	it('gives up, without starting, when the server never stops', async () => {
		fake.states = ['running', 'stopping'];
		await expect(I.restartInstance(instance())).rejects.toThrow(/did not stop/);
	});

	it('just starts a server that is not running', async () => {
		fake.states = [null];
		await expect(I.restartInstance(instance())).rejects.toThrow(/EULA/);
		expect(fake.sent).toEqual([]);
	});
});
