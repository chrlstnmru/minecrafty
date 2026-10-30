import { describe, expect, it, vi } from 'vitest';

const projects = vi.hoisted(() => ({ list: [] as { title: string }[], fail: false }));

vi.mock('./modrinth', async (original) => ({
	...(await original<typeof import('./modrinth')>()),
	getProjects: async () => {
		if (projects.fail) throw new Error('Modrinth is down');
		return projects.list;
	}
}));

const { projectTitle, safeJoin } = await import('./modpacks');

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

describe('projectTitle', () => {
	it('names the pack by its Modrinth title, not by what the index says', async () => {
		projects.fail = false;
		projects.list = [{ title: 'Sodium Plus' }];
		expect(await projectTitle('P', '2.3.7')).toBe('Sodium Plus');
	});

	it('falls back to the index name when Modrinth has no title or cannot be reached', async () => {
		projects.list = [];
		expect(await projectTitle('P', 'index name')).toBe('index name');
		projects.fail = true;
		expect(await projectTitle('P', 'index name')).toBe('index name');
	});
});
