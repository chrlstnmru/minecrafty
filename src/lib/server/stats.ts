import { sum } from 'drizzle-orm';
import { statfsSync } from 'node:fs';
import os from 'node:os';

import { dataDir } from './config';
import { db } from './db';
import { backups } from './db/schema';
import { listInstances, serverDir } from './instances';
import { onlinePlayers } from './players';
import {
	cpuPercent,
	folderSize,
	processCpuPercent,
	readCpuTimes,
	readMemory,
	readProcess,
	type CpuTimes,
	type ProcessUse
} from './system-stats';

export type InstanceStats = {
	id: number;
	/** share of the whole host's CPU, 0 to 100 */
	cpu: number | null;
	rss: number | null;
	uptimeMs: number | null;
	players: { count: number; max: number | null } | null;
	/** the server folder's size; null until it has been measured */
	diskBytes: number | null;
};

export type Snapshot = {
	at: number;
	host: { cpu: number | null; cores: number; memTotal: number; memUsed: number; uptime: number };
	/** the last few minutes, oldest first, for the trend lines */
	history: { cpu: (number | null)[]; mem: number[] };
	storage: { total: number; free: number; instances: number; backups: number };
	instances: Record<number, InstanceStats>;
};

export type RunningInstance = {
	id: number;
	state: string;
	pid: number | null;
	startedAt: number | null;
};

/** Everything the sampler reads from outside, so a test can feed it numbers. */
export type SamplerDeps = {
	now(): number;
	cpuTimes(): CpuTimes;
	memory(): { total: number; available: number };
	cores: number;
	uptime(): number;
	instances(): Promise<RunningInstance[]>;
	process(pid: number): ProcessUse;
	players(id: number): Promise<{ count: number; max: number | null } | null>;
	diskBytes(id: number): number | null;
	storage(): { total: number; free: number; backups: number };
};

const HISTORY = 60;
const PLAYERS_EVERY_MS = 10_000;

export function createSampler(deps: SamplerDeps) {
	let cpuBefore = deps.cpuTimes();
	const cpuHistory: (number | null)[] = [];
	const memHistory: number[] = [];
	const processes = new Map<number, { cpuSeconds: number; at: number }>();
	const players = new Map<
		number,
		{ at: number; value: { count: number; max: number | null } | null }
	>();

	async function sample(): Promise<Snapshot> {
		const now = deps.now();
		const cpuNow = deps.cpuTimes();
		const hostCpu = cpuPercent(cpuBefore, cpuNow);
		cpuBefore = cpuNow;
		const memory = deps.memory();
		const used = memory.total - memory.available;
		cpuHistory.push(hostCpu);
		memHistory.push(used);
		if (cpuHistory.length > HISTORY) cpuHistory.shift();
		if (memHistory.length > HISTORY) memHistory.shift();

		const out: Record<number, InstanceStats> = {};
		const seen = new Set<number>();
		for (const inst of await deps.instances()) {
			const running = (inst.state === 'running' || inst.state === 'stopping') && inst.pid !== null;
			let cpu: number | null = null;
			let rss: number | null = null;
			let current: { count: number; max: number | null } | null = null;
			if (running) {
				seen.add(inst.id);
				const use = deps.process(inst.pid!);
				rss = use.rss;
				if (use.cpuSeconds !== null) {
					const before = processes.get(inst.id);
					if (before)
						cpu = processCpuPercent(before, { cpuSeconds: use.cpuSeconds, at: now }, deps.cores);
					processes.set(inst.id, { cpuSeconds: use.cpuSeconds, at: now });
				}
				const known = players.get(inst.id);
				if (!known || now - known.at >= PLAYERS_EVERY_MS) {
					players.set(inst.id, { at: now, value: await deps.players(inst.id) });
				}
				current = players.get(inst.id)?.value ?? null;
			}
			out[inst.id] = {
				id: inst.id,
				cpu,
				rss,
				uptimeMs: running && inst.startedAt ? Math.max(0, now - inst.startedAt) : null,
				players: current,
				diskBytes: deps.diskBytes(inst.id)
			};
		}
		// what a stopped server used to be doing is not worth remembering
		for (const id of [...processes.keys()]) if (!seen.has(id)) processes.delete(id);
		for (const id of [...players.keys()]) if (!seen.has(id)) players.delete(id);

		const storage = deps.storage();
		return {
			at: now,
			host: {
				cpu: hostCpu,
				cores: deps.cores,
				memTotal: memory.total,
				memUsed: used,
				uptime: deps.uptime()
			},
			history: { cpu: [...cpuHistory], mem: [...memHistory] },
			storage: {
				total: storage.total,
				free: storage.free,
				backups: storage.backups,
				instances: Object.values(out).reduce((n, i) => n + (i.diskBytes ?? 0), 0)
			},
			instances: out
		};
	}

	return { sample };
}

// the real thing: folder sizes come from a slower loop, since walking a world is the costly part
const sizes = new Map<number, number>();
let latest: Snapshot | null = null;
let timers: ReturnType<typeof setInterval>[] = [];

const realDeps: SamplerDeps = {
	now: Date.now,
	cpuTimes: readCpuTimes,
	memory: () => {
		const { total, available } = readMemory();
		return { total, available };
	},
	cores: os.cpus().length || 1,
	uptime: () => os.uptime(),
	instances: async () =>
		(await listInstances()).map(({ id, state, pid, startedAt }) => ({ id, state, pid, startedAt })),
	process: readProcess,
	players: async (id) => {
		const online = await onlinePlayers(id);
		return online.state === 'online' ? { count: online.count, max: online.max } : null;
	},
	diskBytes: (id) => sizes.get(id) ?? null,
	storage: () => {
		const stats = statfsSync(dataDir);
		const total = stats.blocks * stats.bsize;
		const used = db
			.select({ total: sum(backups.size) })
			.from(backups)
			.get()?.total;
		return { total, free: stats.bavail * stats.bsize, backups: Number(used ?? 0) };
	}
};

const sampler = createSampler(realDeps);

/** The newest reading, or one taken now if the sampler has not run yet. */
export async function getSnapshot() {
	return (latest ??= await sampler.sample());
}

/** Measures every server folder, one after the other so a big world does not hog the disk. */
export async function refreshSizes() {
	for (const inst of await listInstances()) {
		try {
			sizes.set(inst.id, await folderSize(serverDir(inst.id)));
		} catch {
			// a folder being deleted under us
		}
	}
	// instances that are gone
	const ids = new Set((await listInstances()).map((i) => i.id));
	for (const id of sizes.keys()) if (!ids.has(id)) sizes.delete(id);
}

/** Starts reading every few seconds, and measuring folders every few minutes. */
export function startStats() {
	if (timers.length) return;
	const take = () =>
		sampler.sample().then(
			(snapshot) => (latest = snapshot),
			() => undefined
		);
	void take();
	// the first measure waits a moment so the panel's start is not slowed down by it
	setTimeout(() => void refreshSizes(), 5000);
	timers = [setInterval(take, 3000), setInterval(() => void refreshSizes(), 5 * 60_000)];
}
