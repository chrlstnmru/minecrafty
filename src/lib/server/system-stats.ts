import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

// The numbers behind the dashboard: the host's CPU and memory, and what one Java process uses.
// The parsing is separate from the reading so it can be tested against real /proc text.

export type CpuTimes = { idle: number; total: number };

/** Where the cores have spent their time so far, summed; two readings give the load in between. */
export function readCpuTimes(): CpuTimes {
	let idle = 0;
	let total = 0;
	for (const { times } of os.cpus()) {
		idle += times.idle;
		total += times.user + times.nice + times.sys + times.idle + times.irq;
	}
	return { idle, total };
}

/** How busy the host was between two readings, 0 to 100; null when no time passed. */
export function cpuPercent(before: CpuTimes, after: CpuTimes) {
	const total = after.total - before.total;
	if (total <= 0) return null;
	return Math.min(100, Math.max(0, (1 - (after.idle - before.idle) / total) * 100));
}

/** Memory in bytes from the text of /proc/meminfo: "available" is what programs could still use. */
export function parseMeminfo(text: string) {
	const kb = (key: string) => {
		const match = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
		return match ? Number(match[1]) * 1024 : null;
	};
	const total = kb('MemTotal');
	const available = kb('MemAvailable') ?? kb('MemFree');
	return total !== null && available !== null ? { total, available } : null;
}

export function readMemory() {
	try {
		const parsed = parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
		if (parsed) return parsed;
	} catch {
		// not Linux
	}
	return { total: os.totalmem(), available: os.freemem() };
}

/** CPU time a process has used so far, in seconds, from the text of /proc/<pid>/stat. */
export function parseProcStat(text: string, ticksPerSecond = 100) {
	// the name in parentheses may hold spaces and parentheses, so count from the last one
	const rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
	const utime = Number(rest[11]);
	const stime = Number(rest[12]);
	return Number.isFinite(utime) && Number.isFinite(stime) ? (utime + stime) / ticksPerSecond : null;
}

/** Resident memory in bytes from the text of /proc/<pid>/status. */
export function parseVmRss(text: string) {
	const match = text.match(/^VmRSS:\s+(\d+) kB/m);
	return match ? Number(match[1]) * 1024 : null;
}

/** "1-02:03:04", "02:03:04", "3:04.50" or "3:04" as seconds, the formats `ps` prints CPU time in. */
export function parsePsTime(text: string) {
	const match = text.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
	if (!match) return null;
	const [, days, hours, minutes, seconds] = match;
	return (
		Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
	);
}

export type ProcessUse = { cpuSeconds: number | null; rss: number | null };

/** What the process with this id has used so far; nulls where the system does not say. */
export function readProcess(pid: number): ProcessUse {
	if (process.platform === 'linux') {
		try {
			return {
				cpuSeconds: parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8')),
				rss: parseVmRss(readFileSync(`/proc/${pid}/status`, 'utf8'))
			};
		} catch {
			return { cpuSeconds: null, rss: null };
		}
	}
	if (process.platform === 'win32') return { cpuSeconds: null, rss: null };
	try {
		// macOS and the BSDs
		const [rss, time] = execFileSync('ps', ['-o', 'rss=,cputime=', '-p', String(pid)], {
			encoding: 'utf8',
			timeout: 2000
		})
			.trim()
			.split(/\s+/);
		return { cpuSeconds: parsePsTime(time ?? ''), rss: Number(rss) * 1024 || null };
	} catch {
		return { cpuSeconds: null, rss: null };
	}
}

/** A process's share of the whole host's CPU between two readings, 0 to 100 (all cores = 100). */
export function processCpuPercent(
	before: { cpuSeconds: number; at: number },
	after: { cpuSeconds: number; at: number },
	cores: number
) {
	const wall = (after.at - before.at) / 1000;
	if (wall <= 0 || cores <= 0) return null;
	return Math.min(100, Math.max(0, ((after.cpuSeconds - before.cpuSeconds) / wall / cores) * 100));
}

/** Bytes under a folder. Links are not followed, and a file that vanishes mid-walk counts as nothing. */
export async function folderSize(path: string): Promise<number> {
	let total = 0;
	let entries;
	try {
		entries = await readdir(path, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = join(path, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) total += await folderSize(full);
		else if (entry.isFile()) {
			try {
				total += lstatSync(full).size;
			} catch {
				// gone since it was listed
			}
		}
	}
	return total;
}
