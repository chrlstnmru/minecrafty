import { describe, expect, it } from 'vitest';

import {
	childFolders,
	folderName,
	insideAny,
	newFolderError,
	openableFolder,
	parentFolder,
	sortFolders
} from './folder-picker';

describe('paths', () => {
	it('finds the folder above, with the top as the empty path', () => {
		expect(parentFolder('config/sodium')).toBe('config');
		expect(parentFolder('config')).toBe('');
		expect(parentFolder('')).toBe('');
		expect(folderName('config/sodium')).toBe('sodium');
		expect(folderName('config')).toBe('config');
	});

	it('tells a moved folder, and everything inside it, from one that only shares a prefix', () => {
		expect(insideAny('config', ['config'])).toBe(true);
		expect(insideAny('config/sodium', ['a.toml', 'config'])).toBe(true);
		expect(insideAny('config2', ['config'])).toBe(false);
		expect(insideAny('config', ['config/sodium'])).toBe(false);
		expect(insideAny('config', [])).toBe(false);
	});
});

describe('the folders a folder holds', () => {
	const all = [
		'config',
		'config/sodium',
		'config/sodium/deep',
		'mods',
		'config/Alpha',
		'plugins',
		'mods'
	];

	it('lists only the ones directly inside, once each, by name', () => {
		expect(childFolders(all, '')).toEqual(['config', 'mods', 'plugins']);
		expect(childFolders(all, 'config')).toEqual(['config/Alpha', 'config/sodium']);
		expect(childFolders(all, 'config/sodium')).toEqual(['config/sodium/deep']);
		expect(childFolders(all, 'mods')).toEqual([]);
	});

	it('orders names the way people read them, numbers by value', () => {
		expect(sortFolders(['pack10', 'Pack2', 'pack1'])).toEqual(['pack1', 'Pack2', 'pack10']);
	});
});

describe('opening the picker', () => {
	it('goes up from a folder that cannot take the move to the nearest one that can', () => {
		const moved = ['config'];
		expect(openableFolder('config/sodium', (p) => insideAny(p, moved))).toBe('');
		expect(openableFolder('mods/a/b', (p) => insideAny(p, ['mods/a']))).toBe('mods');
		expect(openableFolder('plugins', (p) => insideAny(p, moved))).toBe('plugins');
		expect(openableFolder('', () => true)).toBe('');
	});
});

describe('a new folder name', () => {
	it('is refused when empty, a path, dots, or already there, and trimmed otherwise', () => {
		expect(newFolderError('  ', [])).toMatch(/Enter a folder name/);
		expect(newFolderError('a/b', [])).toMatch(/without slashes/);
		expect(newFolderError('a\\b', [])).toMatch(/without slashes/);
		expect(newFolderError('..', [])).toMatch(/without slashes/);
		expect(newFolderError('sodium', ['sodium'])).toBe('sodium already exists here');
		expect(newFolderError(' sodium ', ['sodium'])).toBe('sodium already exists here');
		expect(newFolderError('sodium', ['mods'])).toBeUndefined();
	});
});
