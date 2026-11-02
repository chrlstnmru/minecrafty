import { describe, expect, it } from 'vitest';

import { cleanPath, joinPath, nameOf, parentOf, rebase, under } from './paths';

describe('paths', () => {
	it('tidies slashes: forward, and none at either end', () => {
		expect(cleanPath('\\config\\sodium\\')).toBe('config/sodium');
		expect(cleanPath('//a.toml')).toBe('a.toml');
		expect(cleanPath('/')).toBe('');
	});

	it('finds the folder above and the name, with the top as the empty path', () => {
		expect(parentOf('config/sodium/a.toml')).toBe('config/sodium');
		expect(parentOf('config')).toBe('');
		expect(parentOf('')).toBe('');
		expect(nameOf('config/sodium')).toBe('sodium');
		expect(nameOf('config')).toBe('config');
	});

	it('joins a name onto a folder, the top included', () => {
		expect(joinPath('config', 'a.toml')).toBe('config/a.toml');
		expect(joinPath('', 'a.toml')).toBe('a.toml');
	});

	it('tells a path inside a folder from one that only starts the same', () => {
		expect(under('config', 'config')).toBe(true);
		expect(under('config/a.toml', 'config')).toBe(true);
		expect(under('configs/a.toml', 'config')).toBe(false);
		expect(under('config', 'config/a.toml')).toBe(false);
	});

	it('rebases a path inside a moved folder, and leaves the rest', () => {
		expect(rebase('config/sub/a.toml', 'config', 'moved')).toBe('moved/sub/a.toml');
		expect(rebase('config', 'config', 'moved')).toBe('moved');
		expect(rebase('configs/a.toml', 'config', 'moved')).toBe('configs/a.toml');
	});
});
