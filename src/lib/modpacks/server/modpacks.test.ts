import { describe, expect, it, vi } from 'vitest';

import { zipOf } from '#test/zip.js';

const projects = vi.hoisted(() => ({
	list: [] as { title: string; icon_url?: string }[],
	fail: false
}));

vi.mock('#lib/server/modrinth.js', async (original) => ({
	...(await original<typeof import('#lib/server/modrinth.js')>()),
	getProjects: async () => {
		if (projects.fail) throw new Error('Modrinth is down');
		return projects.list;
	}
}));

const { projectInfo, summarize } = await import('./modpacks');
const { readMrpack, writeIndex } = await import('./mrpack');

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

describe('summarize', () => {
	it('counts every file, says how many are client only, and counts a config file in both overrides/ and server-overrides/ once', async () => {
		const index = writeIndex(
			{
				name: 'Pack',
				summary: '',
				versionNumber: '1',
				mcVersion: '1.21.4',
				loader: 'fabric',
				loaderVersion: '0.16.0'
			},
			[
				{ path: 'mods/a.jar', hashes: {}, downloads: [], fileSize: 10 },
				{
					path: 'mods/b.jar',
					hashes: {},
					downloads: [],
					fileSize: 5,
					env: { server: 'unsupported' }
				}
			]
		);
		const mrpack = readMrpack(
			await zipOf({
				'modrinth.index.json': JSON.stringify(index),
				'overrides/config/a.toml': 'both',
				'server-overrides/config/a.toml': 'server'
			})
		);
		const origin = {
			projectId: 'P',
			versionId: 'V',
			versionNumber: '1',
			name: 'Pack',
			iconUrl: null
		};
		expect(summarize(mrpack, origin)).toMatchObject({
			files: 2,
			clientOnly: 1,
			downloadBytes: 15,
			overrides: 1
		});
	});
});
