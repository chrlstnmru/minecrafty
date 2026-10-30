import { describe, expect, it, vi } from 'vitest';

const projects = vi.hoisted(() => ({
	list: [] as { title: string; icon_url?: string }[],
	fail: false
}));

vi.mock('./modrinth', async (original) => ({
	...(await original<typeof import('./modrinth')>()),
	getProjects: async () => {
		if (projects.fail) throw new Error('Modrinth is down');
		return projects.list;
	}
}));

const { projectInfo, safeJoin } = await import('./modpacks');

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

describe('projectInfo', () => {
	it('names the pack by its Modrinth title, not by what the index says, and gives its icon', async () => {
		projects.fail = false;
		projects.list = [{ title: 'Sodium Plus', icon_url: 'https://cdn.modrinth.com/icon.png' }];
		expect(await projectInfo('P', '2.3.7')).toEqual({
			name: 'Sodium Plus',
			iconUrl: 'https://cdn.modrinth.com/icon.png'
		});
	});

	it('has no icon for a project without one', async () => {
		projects.list = [{ title: 'Plain' }];
		expect((await projectInfo('P', 'x')).iconUrl).toBeNull();
	});

	it('falls back to the index name when Modrinth has no title or cannot be reached', async () => {
		projects.list = [];
		expect(await projectInfo('P', 'index name')).toEqual({ name: 'index name', iconUrl: null });
		projects.fail = true;
		expect(await projectInfo('P', 'index name')).toEqual({ name: 'index name', iconUrl: null });
	});
});
