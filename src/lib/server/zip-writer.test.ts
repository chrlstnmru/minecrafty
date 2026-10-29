import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Zip } from './zip';
import { zipStream, type ZipEntry } from './zip-writer';

const hasUnzip = spawnSync('unzip', ['-v']).status === 0;

/** Builds a small tree on disk and the entry list for it. */
function tree() {
	const dir = mkdtempSync(join(tmpdir(), 'zip-writer-'));
	mkdirSync(join(dir, 'sub'));
	mkdirSync(join(dir, 'empty'));
	writeFileSync(join(dir, 'a.txt'), 'hello zip\n');
	writeFileSync(join(dir, 'zero.txt'), '');
	writeFileSync(join(dir, 'sub', 'ünï cödé.txt'), 'unicode name');
	writeFileSync(join(dir, 'sub', 'text.txt'), 'compressible line\n'.repeat(50_000));
	writeFileSync(join(dir, 'sub', 'random.bin'), randomBytes(3_000_000));
	const modified = new Date('2024-05-06T07:08:10');
	const entries: ZipEntry[] = [
		{ kind: 'file', name: 'a.txt', path: join(dir, 'a.txt'), modified },
		{ kind: 'file', name: 'zero.txt', path: join(dir, 'zero.txt'), modified },
		{ kind: 'dir', name: 'empty', modified },
		{ kind: 'dir', name: 'sub', modified },
		{ kind: 'file', name: 'sub/ünï cödé.txt', path: join(dir, 'sub', 'ünï cödé.txt'), modified },
		{ kind: 'file', name: 'sub/text.txt', path: join(dir, 'sub', 'text.txt'), modified },
		{ kind: 'file', name: 'sub/random.bin', path: join(dir, 'sub', 'random.bin'), modified }
	];
	return { dir, entries };
}

async function build(entries: ZipEntry[]) {
	return new Uint8Array(await new Response(zipStream(entries)).arrayBuffer());
}

describe('zip writer', () => {
	it('produces an archive our reader reads back byte for byte', async () => {
		const { dir, entries } = tree();
		const zip = new Zip(await build(entries));

		expect(zip.entries.map((e) => e.name)).toEqual(
			entries.map((e) => (e.kind === 'dir' ? e.name + '/' : e.name))
		);
		for (const entry of zip.entries.filter((e) => !e.isDir)) {
			expect(Buffer.from(zip.read(entry)).equals(readFileSync(join(dir, entry.name)))).toBe(true);
		}
	});

	it('keeps empty files, empty folders and non-ASCII names', async () => {
		const { entries } = tree();
		const zip = new Zip(await build(entries));
		expect(zip.find('empty/')?.isDir).toBe(true);
		expect(zip.read(zip.find('zero.txt')!).length).toBe(0);
		expect(zip.find('sub/ünï cödé.txt')).toBeDefined();
	});

	it('compresses text but does not blow up incompressible data', async () => {
		const { entries } = tree();
		const zip = new Zip(await build(entries));
		const text = zip.find('sub/text.txt')!;
		const random = zip.find('sub/random.bin')!;
		expect(text.compressedSize).toBeLessThan(text.size / 20);
		expect(random.compressedSize).toBeLessThan(random.size * 1.01);
	});

	it.skipIf(!hasUnzip)('is accepted by the real unzip tool', async () => {
		const { dir, entries } = tree();
		const out = join(dir, 'out.zip');
		writeFileSync(out, await build(entries));
		const result = spawnSync('unzip', ['-t', out], { encoding: 'utf8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('No errors detected');
	});

	it('writes an empty archive that is still valid', async () => {
		const zip = new Zip(await build([]));
		expect(zip.entries).toEqual([]);
	});

	it('fails the stream when a file cannot be read', async () => {
		const { dir } = tree();
		const entries: ZipEntry[] = [
			{ kind: 'file', name: 'gone.txt', path: join(dir, 'does-not-exist'), modified: new Date() }
		];
		await expect(build(entries)).rejects.toThrow();
	});

	it('refuses archives with more entries than a zip can count', async () => {
		const many: ZipEntry[] = Array.from({ length: 0x10000 }, (_, i) => ({
			kind: 'dir',
			name: `d${i}`,
			modified: new Date()
		}));
		await expect(build(many)).rejects.toThrow(/Too many files/);
	});

	it('can include a symlink target as a plain file when asked to', async () => {
		const { dir } = tree();
		symlinkSync(join(dir, 'a.txt'), join(dir, 'link.txt'));
		const zip = new Zip(
			await build([
				{ kind: 'file', name: 'link.txt', path: join(dir, 'link.txt'), modified: new Date() }
			])
		);
		expect(Buffer.from(zip.read(zip.find('link.txt')!)).toString()).toBe('hello zip\n');
	});
});
