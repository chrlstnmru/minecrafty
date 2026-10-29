import {
	appendFileSync,
	mkdirSync,
	renameSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeInstance } from '../../test/instance';
import { serverDir } from './instances';
import { followLog, listLogs, readLog, searchLog, type LogFrame } from './logs';

let id: number;
let logs: string;

const lines = (count: number) =>
	Array.from({ length: count }, (_, i) => `[12:00:${i}] [Server thread/INFO]: line ${i + 1}`).join(
		'\n'
	);

beforeEach(() => {
	id = makeInstance().id;
	logs = join(serverDir(id), 'logs');
	mkdirSync(logs, { recursive: true });
});

describe('listLogs', () => {
	it('puts latest.log first, then the newest rotated logs, and ignores other files', () => {
		writeFileSync(join(logs, 'old.log.gz'), gzipSync('x'));
		writeFileSync(join(logs, 'newer.log.gz'), gzipSync('x'));
		writeFileSync(join(logs, 'latest.log'), 'x');
		writeFileSync(join(logs, 'notes.txt'), 'x');
		mkdirSync(join(logs, 'dir.log'));
		utimesSync(join(logs, 'old.log.gz'), 1, 1);
		const found = listLogs(id);
		expect(found.map((f) => f.name)).toEqual(['latest.log', 'newer.log.gz', 'old.log.gz']);
		expect(found[1]).toMatchObject({ compressed: true });
	});

	it('is empty when the server has not written any logs yet', () => {
		expect(listLogs(makeInstance().id)).toEqual([]);
	});
});

describe('readLog', () => {
	it('returns the last lines with their numbers and the total', async () => {
		writeFileSync(join(logs, 'latest.log'), lines(50));
		const { lines: tail, total } = await readLog(id, 'latest.log', 5);
		expect(total).toBe(50);
		expect(tail.map((l) => l.n)).toEqual([46, 47, 48, 49, 50]);
		expect(tail.at(-1)!.text).toContain('line 50');
	});

	it('returns everything when the log is shorter than the request', async () => {
		writeFileSync(join(logs, 'latest.log'), 'a\nb\n');
		expect(await readLog(id, 'latest.log', 10)).toEqual({
			lines: [
				{ n: 1, text: 'a' },
				{ n: 2, text: 'b' }
			],
			total: 2
		});
	});

	it('reads a gzip-rotated log', async () => {
		writeFileSync(join(logs, '2024-01-01-1.log.gz'), gzipSync(lines(30)));
		const { lines: tail, total } = await readLog(id, '2024-01-01-1.log.gz', 3);
		expect(total).toBe(30);
		expect(tail[2].text).toContain('line 30');
	});

	it('copes with CRLF, colour codes, a missing final newline and very long lines', async () => {
		writeFileSync(join(logs, 'latest.log'), `\x1b[31mred\x1b[0m\r\n${'x'.repeat(5000)}\nlast`);
		const { lines: all } = await readLog(id, 'latest.log', 10);
		expect(all[0].text).toBe('red');
		expect(all[1].text.length).toBe(2000);
		expect(all[2].text).toBe('last');
	});

	it('handles a log far bigger than the tail without keeping it all', async () => {
		writeFileSync(join(logs, 'latest.log'), lines(50_000));
		const { lines: tail, total } = await readLog(id, 'latest.log', 100);
		expect(total).toBe(50_000);
		expect(tail).toHaveLength(100);
		expect(tail[0].n).toBe(49_901);
	});
});

describe('searchLog', () => {
	beforeEach(() => {
		writeFileSync(join(logs, 'latest.log'), 'Alice joined\nbob left\nALICE left\nnothing\n');
	});

	it('finds lines ignoring case by default, with their numbers', async () => {
		const { lines: hits, matches } = await searchLog(id, 'latest.log', 'alice', {
			matchCase: false
		});
		expect(hits.map((l) => l.n)).toEqual([1, 3]);
		expect(matches).toBe(2);
	});

	it('can match case', async () => {
		const { lines: hits } = await searchLog(id, 'latest.log', 'ALICE', { matchCase: true });
		expect(hits.map((l) => l.n)).toEqual([3]);
	});

	it('caps the returned lines but still counts every match', async () => {
		writeFileSync(join(logs, 'big.log'), lines(300));
		const { lines: hits, matches } = await searchLog(id, 'big.log', 'INFO', {
			matchCase: true,
			limit: 10
		});
		expect(hits).toHaveLength(10);
		expect(matches).toBe(300);
	});

	it('searches inside a rotated log', async () => {
		writeFileSync(join(logs, 'a.log.gz'), gzipSync('one\ntwo\nthree two'));
		expect((await searchLog(id, 'a.log.gz', 'two', { matchCase: false })).matches).toBe(2);
	});
});

describe('names that are refused', () => {
	it.each([
		'../server.properties',
		'logs/latest.log',
		'latest.log/',
		'a.txt',
		'.log',
		'latest.log\0'
	])('%j', async (name) => {
		writeFileSync(join(serverDir(id), 'server.properties'), 'x');
		await expect(readLog(id, name, 5)).rejects.toThrow();
		await expect(searchLog(id, name, 'x', { matchCase: true })).rejects.toThrow();
	});

	it('a log that is a symlink out of the instance', async () => {
		const outside = join(serverDir(id), '..', 'secret.log');
		writeFileSync(outside, 'SECRET');
		symlinkSync(outside, join(logs, 'link.log'));
		await expect(readLog(id, 'link.log', 5)).rejects.toThrow();
		expect(listLogs(id).map((f) => f.name)).not.toContain('link.log');
	});
});

describe('followLog', () => {
	const next = async (it: AsyncGenerator<LogFrame>) => (await it.next()).value as LogFrame;

	it('starts from the current end, then reports appended lines with their numbers', async () => {
		writeFileSync(join(logs, 'latest.log'), 'a\nb\n');
		const follow = followLog(id, 10);
		expect(await next(follow)).toEqual({ epoch: 0, total: 2, lines: [] });
		appendFileSync(join(logs, 'latest.log'), 'c\nd\n');
		const frame = await next(follow);
		expect(frame.total).toBe(4);
		expect(frame.lines.map((l) => [l.n, l.text])).toEqual([
			[3, 'c'],
			[4, 'd']
		]);
		await follow.return(undefined);
	});

	it('waits for a line to be finished before sending it', async () => {
		writeFileSync(join(logs, 'latest.log'), '');
		const follow = followLog(id, 10);
		await next(follow);
		appendFileSync(join(logs, 'latest.log'), 'half a li');
		const pending = next(follow);
		await Bun.sleep(60);
		appendFileSync(join(logs, 'latest.log'), 'ne\n');
		expect((await pending).lines).toEqual([{ n: 1, text: 'half a line' }]);
		await follow.return(undefined);
	});

	it('starts a new epoch when the file is replaced', async () => {
		writeFileSync(join(logs, 'latest.log'), 'one\ntwo\nthree\n');
		const follow = followLog(id, 10);
		await next(follow);
		renameSync(join(logs, 'latest.log'), join(logs, 'old.log'));
		writeFileSync(join(logs, 'latest.log'), 'fresh\n');
		const frames = [await next(follow), await next(follow)];
		expect(frames[0]).toEqual({ epoch: 1, total: 0, lines: [] });
		expect(frames[1].epoch).toBe(1);
		expect(frames[1].lines).toEqual([{ n: 1, text: 'fresh' }]);
		await follow.return(undefined);
	});

	it('copes with a log that does not exist yet', async () => {
		const follow = followLog(id, 10);
		expect(await next(follow)).toEqual({ epoch: 0, total: 0, lines: [] });
		writeFileSync(join(logs, 'latest.log'), 'first\n');
		const frames = [await next(follow), await next(follow)];
		expect(frames.at(-1)!.lines.at(-1)).toEqual({ n: 1, text: 'first' });
		await follow.return(undefined);
	});
});
