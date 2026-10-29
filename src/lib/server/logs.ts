import { lstatSync, readdirSync } from 'node:fs';
import { LOG_NAME } from '../log-files';
import { resolveSafe } from './files';

export type LogFile = { name: string; size: number; modified: number; compressed: boolean };
export type LogLine = { n: number; text: string };

const MAX_LINE_CHARS = 2000;
/** Stops a decompression bomb: a gzip log is read until this much text has come out. */
const MAX_SCAN_CHARS = 512 * 1024 * 1024;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** The log files of an instance, `latest.log` first, then the newest rotated ones. */
export function listLogs(instanceId: number): LogFile[] {
	const { absolute } = resolveSafe(instanceId, 'logs');
	let names: string[];
	try {
		names = readdirSync(absolute);
	} catch {
		return [];
	}
	return names
		.filter((name) => LOG_NAME.test(name))
		.flatMap((name) => {
			const stat = lstatSync(`${absolute}/${name}`);
			if (!stat.isFile()) return [];
			return [{ name, size: stat.size, modified: stat.mtimeMs, compressed: name.endsWith('.gz') }];
		})
		.sort(
			(a, b) =>
				Number(b.name === 'latest.log') - Number(a.name === 'latest.log') || b.modified - a.modified
		);
}

function locate(instanceId: number, name: string) {
	if (!LOG_NAME.test(name)) throw new Error('Not a log file');
	const { absolute } = resolveSafe(instanceId, `logs/${name}`);
	if (!lstatSync(absolute).isFile()) throw new Error('Not a log file');
	return { absolute, compressed: name.endsWith('.gz') };
}

/** Every line of a log in order, numbered from 1, decompressing rotated logs on the fly. */
async function* readLines(absolute: string, compressed: boolean) {
	let bytes = Bun.file(absolute).stream() as ReadableStream<BufferSource>;
	if (compressed) bytes = bytes.pipeThrough(new DecompressionStream('gzip'));
	const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();

	let n = 0;
	let scanned = 0;
	let rest = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			scanned += value.length;
			const parts = (rest + value).split('\n');
			rest = parts.pop()!;
			for (const part of parts) yield { n: ++n, text: clean(part) };
			if (scanned > MAX_SCAN_CHARS) return;
		}
		if (rest) yield { n: ++n, text: clean(rest) };
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

const clean = (line: string) => line.replace(/\r$/, '').replace(ANSI, '').slice(0, MAX_LINE_CHARS);

/** The last `count` lines of a log, and how many it has in all. */
export async function readLog(instanceId: number, name: string, count: number) {
	const { absolute, compressed } = locate(instanceId, name);
	let tail: LogLine[] = [];
	let total = 0;
	for await (const line of readLines(absolute, compressed)) {
		total = line.n;
		tail.push(line);
		if (tail.length > count * 2) tail = tail.slice(-count);
	}
	return { lines: tail.slice(-count), total };
}

/** Lines containing `query`, up to `limit`; `matches` counts all of them across the whole log. */
export async function searchLog(
	instanceId: number,
	name: string,
	query: string,
	options: { matchCase: boolean; limit?: number }
) {
	const { absolute, compressed } = locate(instanceId, name);
	const limit = options.limit ?? 500;
	const needle = options.matchCase ? query : query.toLowerCase();
	const lines: LogLine[] = [];
	let matches = 0;
	for await (const line of readLines(absolute, compressed)) {
		const haystack = options.matchCase ? line.text : line.text.toLowerCase();
		if (!haystack.includes(needle)) continue;
		matches++;
		if (lines.length < limit) lines.push(line);
	}
	return { lines, matches };
}
