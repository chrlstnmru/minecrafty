import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyChanges, sha1, type ChangeRules, type Changes } from './change-set';

let root: string;
let asked: string[];

/** Rules that allow everything and note what they were asked. */
const rules = (more: Partial<ChangeRules> = {}): ChangeRules => ({
	root,
	mayTake: (path, how) => void asked.push(`take ${how} ${path}`),
	mayPlace: (path, files) => void asked.push(`place ${path} [${files.join(' ')}]`),
	mayEdit: (path) => void asked.push(`edit ${path}`),
	...more
});

const put = (files: Record<string, string>) => {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
};
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const hashOf = (path: string) => sha1(readFileSync(join(root, path)));
/** Every file under the root, sorted, with its text. */
const tree = () =>
	Object.fromEntries(
		(readdirSync(root, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const path = join(entry.parentPath, entry.name).slice(root.length + 1);
				return [path, read(path)];
			})
			.sort(([a], [b]) => a.localeCompare(b))
	);
const changes = (some: Partial<Changes>): Changes => ({
	moves: [],
	deletes: [],
	writes: [],
	...some
});

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'change-set-'));
	asked = [];
	put({ 'a.txt': 'A', 'b.txt': 'B', 'dir/c.txt': 'C', 'dir/sub/d.txt': 'D' });
});

describe('applying changes', () => {
	it('moves files and whole folders, deletes, and writes, as one step', async () => {
		const result = await applyChanges(
			rules(),
			changes({
				moves: [{ from: 'dir', to: 'moved/dir' }],
				deletes: ['b.txt'],
				writes: [
					{ path: 'a.txt', content: 'A!', original: 'a.txt', baseHash: hashOf('a.txt') },
					{ path: 'new/e.txt', content: 'E' }
				]
			})
		);
		expect(result.changed).toBe(4);
		expect(result.hashes['a.txt']).toBe(sha1(Buffer.from('A!')));
		expect(tree()).toEqual({
			'a.txt': 'A!',
			'moved/dir/c.txt': 'C',
			'moved/dir/sub/d.txt': 'D',
			'new/e.txt': 'E'
		});
	});

	it('lets items swap places, since a moved item frees its name', async () => {
		await applyChanges(
			rules(),
			changes({
				moves: [
					{ from: 'a.txt', to: 'b.txt' },
					{ from: 'b.txt', to: 'a.txt' }
				]
			})
		);
		expect(tree()).toMatchObject({ 'a.txt': 'B', 'b.txt': 'A' });
	});

	it('writes the edit of a file that moves where it goes', async () => {
		await applyChanges(
			rules(),
			changes({
				moves: [{ from: 'dir', to: 'other' }],
				writes: [
					{
						path: 'other/c.txt',
						content: 'C!',
						original: 'dir/c.txt',
						baseHash: hashOf('dir/c.txt')
					}
				]
			})
		);
		expect(read('other/c.txt')).toBe('C!');
	});

	it('counts a write of the same text as no change', async () => {
		const result = await applyChanges(
			rules(),
			changes({
				writes: [{ path: 'a.txt', content: 'A', original: 'a.txt', baseHash: hashOf('a.txt') }]
			})
		);
		expect(result.changed).toBe(0);
	});

	it('removes the folders a move or delete empties, when asked to', async () => {
		await applyChanges(
			rules({ pruneEmpty: true }),
			changes({ moves: [{ from: 'dir/sub/d.txt', to: 'd.txt' }] })
		);
		expect(existsSync(join(root, 'dir/sub'))).toBe(false);
		expect(existsSync(join(root, 'dir'))).toBe(true);

		await applyChanges(rules(), changes({ deletes: ['dir/c.txt'] }));
		expect(existsSync(join(root, 'dir'))).toBe(true);
	});
});

describe('refusing', () => {
	/** Applies `some`, expects a refusal naming `path`, and checks nothing changed. */
	async function refused(
		some: Partial<Changes>,
		path: string,
		message: string | RegExp,
		more = {}
	) {
		const before = tree();
		await expect(applyChanges(rules(more), changes(some))).rejects.toMatchObject({ path });
		await expect(applyChanges(rules(more), changes(some))).rejects.toThrow(message);
		expect(tree()).toEqual(before);
		expect(readdirSync(root).some((name) => name.startsWith('.moving-'))).toBe(false);
	}

	it('a name that is taken, by a file, a folder or another item placed there', async () => {
		await refused({ moves: [{ from: 'b.txt', to: 'dir/c.txt' }] }, 'dir/c.txt', 'already exists');
		await refused({ moves: [{ from: 'b.txt', to: 'dir' }] }, 'dir', 'is a folder');
		await refused({ moves: [{ from: 'b.txt', to: 'a.txt/x' }] }, 'a.txt', 'is a file');
		await refused(
			{
				moves: [
					{ from: 'a.txt', to: 'x.txt' },
					{ from: 'b.txt', to: 'x.txt' }
				]
			},
			'x.txt',
			'already exists'
		);
		await refused({ writes: [{ path: 'b.txt', content: 'new' }] }, 'b.txt', 'already exists');
	});

	it('an item that is missing, moved twice, moved and deleted, or moved into itself', async () => {
		await refused({ moves: [{ from: 'nope.txt', to: 'x.txt' }] }, 'nope.txt', 'not found');
		await refused({ deletes: ['nope.txt'] }, 'nope.txt', 'not found');
		await refused(
			{
				moves: [
					{ from: 'a.txt', to: 'x.txt' },
					{ from: 'a.txt', to: 'y.txt' }
				]
			},
			'a.txt',
			'is moved twice'
		);
		await refused(
			{ moves: [{ from: 'dir', to: 'x' }], deletes: ['dir/c.txt'] },
			'dir/c.txt',
			'is moved and deleted'
		);
		await refused(
			{ moves: [{ from: 'dir', to: 'dir/sub/x' }] },
			'dir',
			'cannot be moved into itself'
		);
		await refused({ moves: [{ from: '', to: 'x' }] }, '', 'cannot be moved');
	});

	it('an edit of a file that changed since it was opened, as stale', async () => {
		const stale = { path: 'a.txt', content: 'A!', original: 'a.txt', baseHash: 'f'.repeat(40) };
		await refused({ writes: [stale] }, 'a.txt', 'changed since you opened it');
		await expect(applyChanges(rules(), changes({ writes: [stale] }))).rejects.toMatchObject({
			kind: 'stale'
		});
		await refused(
			{
				deletes: ['a.txt'],
				writes: [{ ...stale, baseHash: hashOf('a.txt') }]
			},
			'a.txt',
			'changed since you opened it'
		);
	});

	it('a write listed twice, of a type that is not text, too large, or not where its file goes', async () => {
		const edit = { path: 'a.txt', content: '1', original: 'a.txt', baseHash: hashOf('a.txt') };
		await refused({ writes: [edit, { ...edit, content: '2' }] }, 'a.txt', 'is in the list twice');
		await refused({ writes: [{ path: 'x.jar', content: 'x' }] }, 'x.jar', 'cannot be edited');
		await refused(
			{ writes: [{ path: 'big.txt', content: 'x'.repeat(3_000_000) }] },
			'big.txt',
			/too large/
		);
		await refused(
			{ moves: [{ from: 'a.txt', to: 'z.txt' }], writes: [edit] },
			'a.txt',
			'does not go where it was moved to'
		);
	});

	it('a path outside the folder, also through a symlink', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'outside-'));
		symlinkSync(outside, join(root, 'link'));
		await refused({ moves: [{ from: 'a.txt', to: '../x.txt' }] }, '../x.txt', 'not allowed');
		await refused(
			{ writes: [{ path: 'link/x.txt', content: 'x' }] },
			'link/x.txt',
			'leaves the folder'
		);
		expect(readdirSync(outside)).toEqual([]);
	});

	it('what the rules refuse, naming the item they were asked about', async () => {
		const no = (path: string) => () => {
			throw new Error(`not ${path}`);
		};
		await refused({ moves: [{ from: 'a.txt', to: 'x.txt' }] }, 'a.txt', 'not taken', {
			mayTake: no('taken')
		});
		await refused({ moves: [{ from: 'dir', to: 'x' }] }, 'dir', 'not placed', {
			mayPlace: no('placed')
		});
		await refused(
			{ writes: [{ path: 'a.txt', content: '!', original: 'a.txt', baseHash: hashOf('a.txt') }] },
			'a.txt',
			'not edited',
			{ mayEdit: no('edited') }
		);
	});
});

describe('asking the rules', () => {
	it('asks about what leaves, what arrives with the files it brings, and what is edited', async () => {
		await applyChanges(
			rules(),
			changes({
				moves: [{ from: 'dir', to: 'x' }],
				deletes: ['b.txt'],
				writes: [
					{ path: 'a.txt', content: 'A!', original: 'a.txt', baseHash: hashOf('a.txt') },
					{ path: 'new.txt', content: 'N' }
				]
			})
		);
		expect(asked).toEqual([
			'take moved dir',
			'take deleted b.txt',
			'place x [x/c.txt x/sub/d.txt]',
			'edit a.txt',
			'place new.txt [new.txt]'
		]);
	});
});
