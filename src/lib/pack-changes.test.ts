import { describe, expect, it } from 'vitest';

import {
	changesOf,
	countChanges,
	originalOf,
	stageDelete,
	stageMove,
	undoStaged,
	viewOf,
	type Staged
} from './pack-changes';

const files = [
	{ path: 'config/a.toml', size: 1 },
	{ path: 'config/sub/b.toml', size: 2 },
	{ path: 'defaults/c.json', size: 3 },
	{ path: 'options.txt', size: 4 }
];

const stage = (staged: Staged, from: string, to: string) => {
	const result = stageMove(viewOf(files, staged), staged, from, to);
	if ('error' in result) throw new Error(result.error);
	return result.staged;
};

describe('the view', () => {
	it('shows a moved file at its new place, and a deleted one where it was', () => {
		const view = viewOf(files, { 'config/a.toml': 'x/a.toml', 'options.txt': null });
		expect(view.map((f) => [f.path, f.original, f.moved, f.deleted])).toEqual([
			['x/a.toml', 'config/a.toml', true, false],
			['config/sub/b.toml', 'config/sub/b.toml', false, false],
			['defaults/c.json', 'defaults/c.json', false, false],
			['options.txt', 'options.txt', false, true]
		]);
	});

	it('finds where the file showing at a path is on the server, and nothing for a deleted or new one', () => {
		const view = viewOf(files, { 'config/a.toml': 'x/a.toml', 'options.txt': null });
		expect(originalOf(view, 'x/a.toml')).toBe('config/a.toml');
		expect(originalOf(view, 'config/a.toml')).toBeUndefined();
		expect(originalOf(view, 'options.txt')).toBeUndefined();
		expect(originalOf(view, 'brand-new.txt')).toBeUndefined();
	});
});

describe('staging a move', () => {
	it('moves a file, and a folder with everything in it', () => {
		expect(stage({}, 'options.txt', 'config/options.txt')).toEqual({
			'options.txt': 'config/options.txt'
		});
		expect(stage({}, 'config', 'moved/config')).toEqual({
			'config/a.toml': 'moved/config/a.toml',
			'config/sub/b.toml': 'moved/config/sub/b.toml'
		});
	});

	it('follows a file that is moved again, and takes the change away when it goes back', () => {
		const once = stage({}, 'options.txt', 'one/options.txt');
		expect(stage(once, 'one/options.txt', 'two/options.txt')).toEqual({
			'options.txt': 'two/options.txt'
		});
		expect(stage(once, 'one/options.txt', 'options.txt')).toEqual({});
	});

	it('moves part of a folder that was moved', () => {
		const first = stage({}, 'config', 'moved/config');
		expect(stage(first, 'moved/config/sub', 'sub')).toEqual({
			'config/a.toml': 'moved/config/a.toml',
			'config/sub/b.toml': 'sub/b.toml'
		});
	});

	it('refuses a name that is taken, one that clashes with a file or folder, and a folder into itself', () => {
		const refused = (from: string, to: string, message: string, staged: Staged = {}) => {
			const result = stageMove(viewOf(files, staged), staged, from, to);
			expect(result).toEqual({ error: message });
		};
		refused('options.txt', 'config/a.toml', 'config/a.toml already exists');
		refused('options.txt', 'config', 'config is a folder');
		refused('options.txt', 'defaults/c.json/x', 'defaults/c.json is a file');
		refused('config', 'config/sub/config', 'config cannot be moved into itself');
		refused('nope', 'x', 'nope not found');
		// a file waiting to be deleted still holds its name
		refused('options.txt', 'config/a.toml', 'config/a.toml already exists', {
			'config/a.toml': null
		});
	});

	it('lets a folder move onto the place its own files leave', () => {
		const shifted = stage({}, 'config', 'config2');
		expect(shifted['config/a.toml']).toBe('config2/a.toml');
		expect(stage({}, 'config/sub', 'sub')).toEqual({ 'config/sub/b.toml': 'sub/b.toml' });
	});
});

describe('staging a delete', () => {
	it('deletes a file, a folder with its files, and a file that was moved (by where it is on the server)', () => {
		const view = viewOf(files, {});
		expect(stageDelete(view, {}, 'options.txt')).toEqual({ 'options.txt': null });
		expect(stageDelete(view, {}, 'config')).toEqual({
			'config/a.toml': null,
			'config/sub/b.toml': null
		});
		const moved = { 'options.txt': 'x/options.txt' };
		expect(stageDelete(viewOf(files, moved), moved, 'x/options.txt')).toEqual({
			'options.txt': null
		});
	});

	it('can be taken away', () => {
		expect(undoStaged({ 'options.txt': null, 'config/a.toml': 'x' }, 'options.txt')).toEqual({
			'config/a.toml': 'x'
		});
	});
});

describe('what to save', () => {
	it('lists the moves, the deletes and the texts, an edited file by where it is on the server', () => {
		const staged: Staged = { 'config/a.toml': 'x/a.toml', 'options.txt': null };
		const view = viewOf(files, staged);
		expect(
			changesOf(view, staged, [
				{ path: 'x/a.toml', content: 'a = 2', hash: 'h1', isNew: false },
				{ path: 'fresh.txt', content: 'new', isNew: true }
			])
		).toEqual({
			moves: [{ from: 'config/a.toml', to: 'x/a.toml' }],
			deletes: ['options.txt'],
			writes: [
				{ path: 'x/a.toml', content: 'a = 2', original: 'config/a.toml', baseHash: 'h1' },
				{ path: 'fresh.txt', content: 'new' }
			]
		});
	});

	it('counts a file once however many changes it has', () => {
		const staged: Staged = { 'config/a.toml': 'x/a.toml', 'options.txt': null };
		const view = viewOf(files, staged);
		expect(
			countChanges(view, staged, [
				{ path: 'x/a.toml', content: 'edited too', hash: 'h', isNew: false },
				{ path: 'defaults/c.json', content: 'edited', hash: 'h', isNew: false },
				{ path: 'fresh.txt', content: 'new', isNew: true }
			])
		).toBe(4);
		expect(countChanges(view, {}, [])).toBe(0);
	});
});
