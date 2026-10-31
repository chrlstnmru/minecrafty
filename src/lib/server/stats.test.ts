import { describe, expect, it } from 'vitest';

import { createSampler, type RunningInstance, type SamplerDeps } from './stats';

// The sampler is fed numbers by hand: a clock that moves when told to, CPU counters, instances.
function rig(overrides: Partial<SamplerDeps> = {}) {
	const clock = { now: 1_000_000, idle: 0, total: 0, mem: { total: 8e9, available: 6e9 } };
	const instances: RunningInstance[] = [];
	const proc = new Map<number, { cpuSeconds: number | null; rss: number | null }>();
	const playerCalls: number[] = [];
	const deps: SamplerDeps = {
		now: () => clock.now,
		cpuTimes: () => ({ idle: clock.idle, total: clock.total }),
		memory: () => clock.mem,
		cores: 4,
		uptime: () => 5000,
		instances: async () => instances,
		process: (pid) => proc.get(pid) ?? { cpuSeconds: null, rss: null },
		players: async (id) => {
			playerCalls.push(id);
			return { count: 2, max: 20 };
		},
		diskBytes: (id) => (id === 1 ? 5000 : null),
		storage: () => ({ total: 100e9, free: 40e9, backups: 3000 }),
		...overrides
	};
	return { clock, instances, proc, playerCalls, sampler: createSampler(deps) };
}

const running = (id: number, pid: number, startedAt = 1_000_000 - 90_000): RunningInstance => ({
	id,
	state: 'running',
	pid,
	startedAt
});

describe('the host', () => {
	it('reports CPU as the busy share since the last reading, memory as what is in use', async () => {
		const { clock, sampler } = rig();
		await sampler.sample();
		clock.now += 3000;
		clock.total += 1000;
		clock.idle += 750;
		const { host } = await sampler.sample();
		expect(host.cpu).toBe(25);
		expect(host.memUsed).toBe(2e9);
		expect(host.memTotal).toBe(8e9);
		expect(host).toMatchObject({ cores: 4, uptime: 5000 });
	});

	it('keeps a trend of the last sixty readings, oldest first', async () => {
		const { clock, sampler } = rig();
		let last = await sampler.sample();
		for (let i = 1; i <= 70; i++) {
			clock.now += 3000;
			clock.total += 100;
			clock.idle += 100 - i; // busier each time
			last = await sampler.sample();
		}
		expect(last.history.cpu).toHaveLength(60);
		expect(last.history.mem).toHaveLength(60);
		const cpu = last.history.cpu as number[];
		expect(cpu.at(-1)).toBe(70);
		expect(cpu[0]).toBeCloseTo(11);
		expect([...cpu].sort((a, b) => a - b)).toEqual(cpu);
	});
});

describe('a running server', () => {
	it('has memory and uptime at once, and CPU from the second reading on', async () => {
		const { clock, instances, proc, sampler } = rig();
		instances.push(running(1, 4242));
		proc.set(4242, { cpuSeconds: 10, rss: 2e9 });
		const first = (await sampler.sample()).instances[1];
		expect(first).toMatchObject({ rss: 2e9, uptimeMs: 90_000, cpu: null });

		clock.now += 3000;
		proc.set(4242, { cpuSeconds: 13, rss: 2.1e9 });
		const second = (await sampler.sample()).instances[1];
		// one full core for 3 s on a four-core host is a quarter of it
		expect(second).toMatchObject({ cpu: 25, rss: 2.1e9, uptimeMs: 93_000 });
	});

	it('has the folder size once it was measured, and nothing for one that was not', async () => {
		const { instances, sampler } = rig();
		instances.push(running(1, 1), { id: 2, state: 'stopped', pid: null, startedAt: null });
		const { instances: out } = await sampler.sample();
		expect(out[1].diskBytes).toBe(5000);
		expect(out[2].diskBytes).toBeNull();
	});

	it('copes with a system that does not say, such as Windows', async () => {
		const { instances, proc, sampler } = rig();
		instances.push(running(1, 7));
		proc.set(7, { cpuSeconds: null, rss: null });
		expect((await sampler.sample()).instances[1]).toMatchObject({ cpu: null, rss: null });
	});

	it('shows a stopping server as still running, since it is still using the machine', async () => {
		const { instances, proc, sampler } = rig();
		instances.push({ id: 1, state: 'stopping', pid: 9, startedAt: 1 });
		proc.set(9, { cpuSeconds: 1, rss: 1e9 });
		expect((await sampler.sample()).instances[1].rss).toBe(1e9);
	});
});

describe('a stopped server', () => {
	it('has no CPU, memory, uptime or players', async () => {
		const { instances, sampler } = rig();
		instances.push({ id: 1, state: 'stopped', pid: null, startedAt: null });
		expect((await sampler.sample()).instances[1]).toMatchObject({
			cpu: null,
			rss: null,
			uptimeMs: null,
			players: null
		});
	});

	it('starts its CPU reading afresh when it runs again, not from the last run', async () => {
		const { clock, instances, proc, sampler } = rig();
		instances.push(running(1, 11));
		proc.set(11, { cpuSeconds: 100, rss: 1e9 });
		await sampler.sample();
		instances[0] = { id: 1, state: 'stopped', pid: null, startedAt: null };
		clock.now += 3000;
		await sampler.sample();
		instances[0] = running(1, 12);
		proc.set(12, { cpuSeconds: 2, rss: 1e9 });
		clock.now += 3000;
		expect((await sampler.sample()).instances[1].cpu).toBeNull();
	});
});

describe('players', () => {
	it('asks the server only every ten seconds, not on every reading', async () => {
		const { clock, instances, playerCalls, sampler } = rig();
		instances.push(running(1, 1));
		for (let i = 0; i < 4; i++) {
			await sampler.sample();
			clock.now += 3000;
		}
		// readings at 0, 3, 6 and 9 seconds: one question; the one at 12 seconds asks again
		expect(playerCalls).toHaveLength(1);
		const snapshot = await sampler.sample();
		expect(playerCalls).toHaveLength(2);
		expect(snapshot.instances[1].players).toEqual({ count: 2, max: 20 });
	});

	it('is null when the server cannot say', async () => {
		const { instances, sampler } = rig({ players: async () => null });
		instances.push(running(1, 1));
		expect((await sampler.sample()).instances[1].players).toBeNull();
	});
});

describe('storage', () => {
	it('adds the measured server folders to what the volume and the backups say', async () => {
		const { instances, sampler } = rig({ diskBytes: (id) => id * 1000 });
		instances.push(running(1, 1), running(2, 2), {
			id: 3,
			state: 'stopped',
			pid: null,
			startedAt: null
		});
		const { storage } = await sampler.sample();
		expect(storage).toEqual({ total: 100e9, free: 40e9, backups: 3000, instances: 6000 });
	});
});
