import { describe, expect, it } from 'vitest';
import { safeJoin } from './modpacks';

// A modpack names the files it wants, and those names are data from a stranger.
describe('safeJoin', () => {
	const base = '/srv/instance/server';

	it('joins an ordinary relative path', () => {
		expect(safeJoin(base, 'mods/sodium.jar')).toBe('/srv/instance/server/mods/sodium.jar');
		expect(safeJoin(base, 'config/a/b/c.toml')).toBe('/srv/instance/server/config/a/b/c.toml');
	});

	it('treats backslashes as separators', () => {
		expect(safeJoin(base, 'mods\\a.jar')).toBe('/srv/instance/server/mods/a.jar');
	});

	it.each([
		'../escape.txt',
		'mods/../../escape.txt',
		'/etc/passwd',
		'C:\\Windows\\x',
		'c:/x',
		'..',
		'a/../../b',
		''
	])('refuses %j', (path) => {
		expect(() => safeJoin(base, path)).toThrow(/unsafe path/);
	});

	it('allows ".." inside a name that is not a path segment', () => {
		expect(safeJoin(base, 'mods/a..b.jar')).toBe('/srv/instance/server/mods/a..b.jar');
	});
});
