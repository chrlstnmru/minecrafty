import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { makeInstance } from '#test/instance.js';
import { holdJob } from '#test/jobs.js';

import { run } from './instance-jobs';
import { serverDir } from './instances';
import { install, listInstalled } from './mods';

// Modrinth and the download are replaced: what matters is what holds the instance during the wait.
const fake = vi.hoisted(() => ({
	gate: Promise.resolve(),
	downloads: 0
}));

vi.mock('./download', () => ({
	downloadFile: async (dest: string) => {
		fake.downloads++;
		await fake.gate;
		await writeFile(dest, 'jar');
	}
}));

vi.mock('./modrinth', async (original) => ({
	...(await original<typeof import('./modrinth')>()),
	getProjects: async () => [{ id: 'P', title: 'Sodium' }]
}));

vi.mock('./mod-resolver', () => ({
	pickFile: () => ({ filename: 'sodium.jar', url: 'https://x', hashes: { sha512: 'h' } }),
	resolveMods: async () => ({
		planned: new Map([['P', { version: { id: 'v', version_number: '1' }, dependencyOf: null }]]),
		skipped: []
	})
}));

const fabric = () => makeInstance({ loader: 'fabric' });

describe('a mod install', () => {
	it('holds the instance for its download, so a restore cannot swap the folder under it', async () => {
		const { id } = fabric();
		const { promise, resolve } = Promise.withResolvers<void>();
		fake.gate = promise;
		const before = fake.downloads;
		const installing = install(id, 'P');
		await vi.waitFor(() => expect(fake.downloads).toBe(before + 1));

		await expect(run(id, 'restore', async () => {})).rejects.toThrow(
			'Files are being added to this server'
		);
		await expect(install(id, 'Q')).rejects.toThrow('Try again when that finishes');

		resolve();
		await expect(installing).resolves.toMatchObject({
			installed: [{ title: 'Sodium', version: '1' }]
		});
		expect(existsSync(join(serverDir(id), 'mods/sodium.jar'))).toBe(true);
		expect(listInstalled(id).map((m) => m.file)).toEqual(['mods/sodium.jar']);
	});

	it('is refused during a backup, before it downloads anything', async () => {
		const { id } = fabric();
		const before = fake.downloads;
		const letGo = await holdJob(id, 'backup');
		await expect(install(id, 'P')).rejects.toThrow(
			'A backup is already running. Try again when it finishes.'
		);
		await letGo();
		expect(fake.downloads).toBe(before);
	});

	it('gives the instance back when it fails', async () => {
		const { id } = fabric();
		await install(id, 'P');
		await expect(install(id, 'P')).rejects.toThrow('Already installed');
		await expect(run(id, 'write', async () => 'free')).resolves.toBe('free');
	});
});
