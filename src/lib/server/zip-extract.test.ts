import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { safeEntryName } from '#lib/safe-entry-name.js';
import { extractZip } from './zip-extract';
import { listZipEntries } from './zip-entries';
import { zipStream, type ZipEntry } from './zip-writer';

let work: string;
let dest: string;
const zipPath = () => join(work, 'a.zip');

async function zipTo(entries: ZipEntry[]) {
	await Bun.write(zipPath(), new Response(zipStream(entries)));
}

/** A file entry whose name is whatever the test needs, backed by a real file. */
function named(name: string): ZipEntry {
	const path = join(work, 'payload.txt');
	writeFileSync(path, 'payload');
	return { kind: 'file', name, path, modified: new Date() };
}

beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), 'zip-extract-'));
	dest = join(work, 'out');
});

describe('extractZip', () => {
	it('restores folders, empty files, unicode names and large random data exactly', async () => {
		const src = join(work, 'src');
		mkdirSync(join(src, 'sub', 'deeper'), { recursive: true });
		mkdirSync(join(src, 'empty'));
		writeFileSync(join(src, 'a.txt'), 'hello\n');
		writeFileSync(join(src, 'zero.txt'), '');
		writeFileSync(join(src, 'sub', 'ünï cödé.txt'), 'unicode');
		writeFileSync(join(src, 'sub', 'deeper', 'text.txt'), 'compressible\n'.repeat(80_000));
		const random = randomBytes(3_000_000);
		writeFileSync(join(src, 'sub', 'random.bin'), random);

		await zipTo(listZipEntries(src));
		expect(await extractZip(zipPath(), dest)).toBe(5);

		expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('hello\n');
		expect(statSync(join(dest, 'zero.txt')).size).toBe(0);
		expect(readFileSync(join(dest, 'sub', 'ünï cödé.txt'), 'utf8')).toBe('unicode');
		expect(statSync(join(dest, 'empty')).isDirectory()).toBe(true);
		expect(readFileSync(join(dest, 'sub', 'random.bin')).equals(random)).toBe(true);
		expect(readFileSync(join(dest, 'sub', 'deeper', 'text.txt'), 'utf8')).toBe(
			'compressible\n'.repeat(80_000)
		);
	});

	it.each([
		'../evil.txt',
		'a/../../evil.txt',
		'/abs/evil.txt',
		'C:/evil.txt',
		'a\\..\\evil.txt',
		'..'
	])('refuses the name %j before writing anything', async (name) => {
		await zipTo([named('fine.txt'), named(name)]);
		await expect(extractZip(zipPath(), dest)).rejects.toThrow(/Unsafe path/);
		expect(readdirSync(dest)).toEqual([]);
		expect(existsSync(join(work, 'evil.txt'))).toBe(false);
	});

	it('refuses a damaged file instead of restoring wrong data', async () => {
		const src = join(work, 'src');
		mkdirSync(src);
		writeFileSync(join(src, 'data.bin'), randomBytes(200_000));
		await zipTo(listZipEntries(src));
		const bytes = readFileSync(zipPath());
		bytes[5000] ^= 0xff;
		writeFileSync(zipPath(), bytes);
		await expect(extractZip(zipPath(), dest)).rejects.toThrow();
	});

	it('refuses a truncated archive and a file that is not a zip', async () => {
		const src = join(work, 'src');
		mkdirSync(src);
		writeFileSync(join(src, 'data.bin'), randomBytes(50_000));
		await zipTo(listZipEntries(src));
		writeFileSync(zipPath(), readFileSync(zipPath()).subarray(0, 100));
		await expect(extractZip(zipPath(), dest)).rejects.toThrow();

		writeFileSync(zipPath(), 'definitely not a zip, just some text '.repeat(10));
		await expect(extractZip(zipPath(), dest)).rejects.toThrow(/Not a valid zip/);
	});
});

describe('safeEntryName', () => {
	it('keeps plain relative paths and drops "./" and doubled slashes', () => {
		expect(safeEntryName('a/b.txt')).toBe('a/b.txt');
		expect(safeEntryName('./a//b.txt')).toBe('a/b.txt');
		expect(safeEntryName('dir/')).toBe('dir');
	});

	it('rejects everything that could leave the folder', () => {
		for (const bad of ['', '/x', '../x', 'a/../b', 'a\\b', 'C:x', 'a\0b', '.', './'])
			expect(safeEntryName(bad), JSON.stringify(bad)).toBeNull();
	});
});
