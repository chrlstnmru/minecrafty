import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	cpuPercent,
	folderSize,
	parseMeminfo,
	parseProcStat,
	parsePsTime,
	parseVmRss,
	processCpuPercent,
	readCpuTimes,
	readMemory,
	readProcess
} from './system-stats';

describe('cpuPercent', () => {
	it('is the share of time not spent idle', () => {
		expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
		expect(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(100);
		expect(cpuPercent({ idle: 0, total: 0 }, { idle: 100, total: 100 })).toBe(0);
	});

	it('has nothing to say when no time passed, and stays between 0 and 100', () => {
		expect(cpuPercent({ idle: 5, total: 10 }, { idle: 5, total: 10 })).toBeNull();
		expect(cpuPercent({ idle: 0, total: 0 }, { idle: -5, total: 10 })).toBe(100);
	});

	it('reads real counters that only grow', () => {
		const a = readCpuTimes();
		const b = readCpuTimes();
		expect(b.total).toBeGreaterThanOrEqual(a.total);
		expect(a.total).toBeGreaterThan(0);
	});
});

describe('parseMeminfo', () => {
	const text =
		'MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    8192000 kB\nBuffers: 5 kB\n';

	it('reads total and available memory as bytes', () => {
		expect(parseMeminfo(text)).toEqual({ total: 16384000 * 1024, available: 8192000 * 1024 });
	});

	it('falls back to free memory on an old kernel, and gives up on junk', () => {
		expect(parseMeminfo('MemTotal: 100 kB\nMemFree: 40 kB\n')).toEqual({
			total: 100 * 1024,
			available: 40 * 1024
		});
		expect(parseMeminfo('nonsense')).toBeNull();
	});

	it('reads this machine', () => {
		const memory = readMemory();
		expect(memory.total).toBeGreaterThan(memory.available);
		expect(memory.available).toBeGreaterThan(0);
	});
});

describe('parseProcStat', () => {
	// pid (name) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime ...
	const line = (name: string) =>
		`4242 (${name}) S 1 4242 4242 0 -1 4194304 100 0 0 0 1500 500 0 0 20 0 30 0 123456 1000000 5000 18446744073709551615`;

	it('adds user and system time, in seconds', () => {
		expect(parseProcStat(line('java'))).toBe(20);
		expect(parseProcStat(line('java'), 1000)).toBe(2);
	});

	it('is not confused by spaces and parentheses in the process name', () => {
		expect(parseProcStat(line('java -jar (server) x'))).toBe(20);
	});

	it('gives up on text it cannot read', () => {
		expect(parseProcStat('garbage')).toBeNull();
		expect(parseProcStat('')).toBeNull();
	});
});

describe('parseVmRss', () => {
	it('reads resident memory as bytes', () => {
		expect(parseVmRss('Name:\tjava\nVmPeak:\t 900 kB\nVmRSS:\t   2048 kB\nThreads:\t5\n')).toBe(
			2048 * 1024
		);
		expect(parseVmRss('Name:\tjava\n')).toBeNull();
	});
});

describe('parsePsTime', () => {
	it.each([
		['0:12.50', 12.5],
		['3:04', 184],
		['02:03:04', 7384],
		['1-02:03:04', 86400 + 7384],
		['  0:01  ', 1]
	])('%j is %d seconds', (text, seconds) => {
		expect(parsePsTime(text)).toBe(seconds);
	});

	it('gives up on anything else', () => {
		expect(parsePsTime('')).toBeNull();
		expect(parsePsTime('abc')).toBeNull();
	});
});

describe('readProcess', () => {
	it.runIf(process.platform === 'linux')('reads this process', () => {
		const use = readProcess(process.pid);
		expect(use.cpuSeconds).toBeGreaterThanOrEqual(0);
		expect(use.rss).toBeGreaterThan(1024 * 1024);
	});

	it('has nulls for a process that does not exist', () => {
		expect(readProcess(2 ** 30)).toEqual({ cpuSeconds: null, rss: null });
	});
});

describe('processCpuPercent', () => {
	it('is the share of the whole host, so a full core on four cores is 25', () => {
		const before = { cpuSeconds: 10, at: 0 };
		expect(processCpuPercent(before, { cpuSeconds: 13, at: 3000 }, 4)).toBe(25);
		expect(processCpuPercent(before, { cpuSeconds: 16, at: 3000 }, 4)).toBe(50);
	});

	it('stays within 0 to 100 and needs time to have passed', () => {
		expect(processCpuPercent({ cpuSeconds: 0, at: 0 }, { cpuSeconds: 99, at: 1000 }, 1)).toBe(100);
		expect(processCpuPercent({ cpuSeconds: 5, at: 0 }, { cpuSeconds: 5, at: 0 }, 4)).toBeNull();
		expect(processCpuPercent({ cpuSeconds: 5, at: 0 }, { cpuSeconds: 3, at: 1000 }, 4)).toBe(0);
	});
});

describe('folderSize', () => {
	it('adds up every file below, and counts a missing folder as empty', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'size-'));
		mkdirSync(join(dir, 'a', 'b'), { recursive: true });
		writeFileSync(join(dir, 'x.bin'), Buffer.alloc(1000));
		writeFileSync(join(dir, 'a', 'y.bin'), Buffer.alloc(2000));
		writeFileSync(join(dir, 'a', 'b', 'z.bin'), Buffer.alloc(300));
		expect(await folderSize(dir)).toBe(3300);
		expect(await folderSize(join(dir, 'nope'))).toBe(0);
	});

	it('does not follow links out of the folder', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'outside-'));
		writeFileSync(join(outside, 'big.bin'), Buffer.alloc(100_000));
		const dir = mkdtempSync(join(tmpdir(), 'size-'));
		writeFileSync(join(dir, 'x.bin'), Buffer.alloc(10));
		symlinkSync(outside, join(dir, 'link'));
		expect(existsSync(join(dir, 'link', 'big.bin'))).toBe(true);
		expect(await folderSize(dir)).toBe(10);
	});
});
