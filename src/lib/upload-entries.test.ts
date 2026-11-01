import { describe, expect, it } from 'vitest';

import { batches, collectEntries, fromFileList, readDropped, type FsEntry } from './upload-entries';

const file = (name: string, text: string, fullPath: string): FsEntry => ({
	isFile: true,
	isDirectory: false,
	name,
	fullPath,
	file: (ok) => ok(new File([text], name))
});

/** A directory whose reader hands out `perCall` entries at a time, like Chrome's does. */
const dir = (name: string, fullPath: string, children: FsEntry[], perCall = 2): FsEntry => ({
	isFile: false,
	isDirectory: true,
	name,
	fullPath,
	createReader: () => {
		let at = 0;
		return {
			readEntries: (ok) => {
				ok(children.slice(at, at + perCall));
				at += perCall;
			}
		};
	}
});

describe('collectEntries', () => {
	const pack = dir('pack', '/pack', [
		file('a.jar', 'A', '/pack/a.jar'),
		file('b.jar', 'B', '/pack/b.jar'),
		file('c.jar', 'C', '/pack/c.jar'),
		dir('sub', '/pack/sub', [
			file('d.txt', 'D', '/pack/sub/d.txt'),
			file('e.txt', 'E', '/pack/sub/e.txt')
		]),
		dir('empty', '/pack/empty', [])
	]);

	it('finds every file, reading directories in several batches', async () => {
		const items = await collectEntries([pack]);
		expect(items.map((i) => i.path).sort()).toEqual([
			'pack/a.jar',
			'pack/b.jar',
			'pack/c.jar',
			'pack/sub/d.txt',
			'pack/sub/e.txt'
		]);
	});

	it('keeps the dropped folder name and drops the leading slash', async () => {
		const items = await collectEntries([pack]);
		expect(items.every((i) => !i.path.startsWith('/'))).toBe(true);
	});

	it('keeps loose files at the top level', async () => {
		const items = await collectEntries([file('loose.txt', 'L', '/loose.txt'), pack]);
		expect(items.some((i) => i.path === 'loose.txt')).toBe(true);
	});

	it('reads the file contents', async () => {
		const [item] = await collectEntries([file('a.txt', 'hello', '/a.txt')]);
		expect(await item.file.text()).toBe('hello');
	});

	it('stops walking once past the item cap', async () => {
		const many = dir(
			'many',
			'/many',
			Array.from({ length: 6000 }, (_, i) => file(`f${i}`, 'x', `/many/f${i}`)),
			500
		);
		const items = await collectEntries([many]);
		expect(items.length).toBeLessThan(6000);
	});
});

describe('readDropped', () => {
	/** What a drop hands over: items that can say what entry they are, and the plain file list. */
	const dropOf = (entries: (FsEntry | null)[], files: File[] = []) => ({
		items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
		files
	});

	it('walks dropped folders and keeps their names', async () => {
		const pack = dir('pack', '/pack', [file('a.txt', 'A', '/pack/a.txt')]);
		const items = await readDropped(dropOf([pack, file('b.txt', 'B', '/b.txt')]) as never);
		expect(items.map((i) => i.path).sort()).toEqual(['b.txt', 'pack/a.txt']);
	});

	it('takes the entries before the first wait, since the browser empties the drop after the handler', async () => {
		const transfer = dropOf([file('a.txt', 'A', '/a.txt')]);
		const read = readDropped(transfer as never);
		// what a browser does once the handler returns
		transfer.items.length = 0;
		expect((await read).map((i) => i.path)).toEqual(['a.txt']);
	});

	it('uses the plain files when folders are off or no entry can be read', async () => {
		const plain = new File(['x'], 'plain.txt');
		expect(
			(await readDropped(dropOf([file('a.txt', 'A', '/a.txt')], [plain]) as never, false)).map(
				(i) => i.path
			)
		).toEqual(['plain.txt']);
		expect((await readDropped(dropOf([null], [plain]) as never)).map((i) => i.path)).toEqual([
			'plain.txt'
		]);
	});
});

describe('fromFileList', () => {
	it('uses the name for plain files and the relative path for a picked folder', () => {
		const plain = new File(['x'], 'a.txt');
		const nested = new File(['y'], 'b.txt');
		Object.defineProperty(nested, 'webkitRelativePath', { value: 'folder/b.txt' });
		expect(fromFileList([plain, nested]).map((i) => i.path)).toEqual(['a.txt', 'folder/b.txt']);
	});
});

describe('batches', () => {
	const items = (n: number, size: number) =>
		Array.from({ length: n }, (_, i) => ({
			file: new File([new Uint8Array(size)], `f${i}`),
			path: `f${i}`
		}));

	it('keeps a small drop in one request', () => {
		expect(batches(items(10, 100))).toHaveLength(1);
	});

	it('starts a new request when the byte budget is reached', () => {
		expect(batches(items(5, 100), 250).map((b) => b.length)).toEqual([2, 2, 1]);
	});

	it('starts a new request when the file count is reached', () => {
		expect(batches(items(5, 1), 1000, 2).map((b) => b.length)).toEqual([2, 2, 1]);
	});

	it('lets a file bigger than the budget travel alone', () => {
		expect(batches(items(1, 500), 250)).toHaveLength(1);
	});

	it('returns nothing for an empty queue and preserves order', () => {
		expect(batches([])).toEqual([]);
		expect(
			batches(items(5, 100), 250)
				.flat()
				.map((i) => i.path)
		).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
	});
});
