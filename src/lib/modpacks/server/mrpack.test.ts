import { describe, expect, it } from 'vitest';

import { zipOf } from '#test/zip.js';

import { readMrpack, safeJoin, writeIndex, type PackFields } from './mrpack';

const fields: PackFields = {
	name: 'Pack',
	summary: 'A pack',
	versionNumber: '1.0',
	mcVersion: '1.21.4',
	loader: 'fabric',
	loaderVersion: '0.16.0'
};
const file = (path: string, server?: string) => ({
	path,
	hashes: { sha1: 'a' },
	downloads: ['https://cdn.modrinth.com/x'],
	...(server ? { env: { server } } : {})
});
const pack = (files: Record<string, string>, index: object = writeIndex(fields, [])) =>
	zipOf({ 'modrinth.index.json': JSON.stringify(index), ...files });

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

describe('readMrpack', () => {
	it('reads back what writeIndex wrote', async () => {
		const read = readMrpack(await pack({}, writeIndex(fields, [file('mods/a.jar')])));
		expect(read).toMatchObject(fields);
		expect(read.files.map((f) => f.path)).toEqual(['mods/a.jar']);
	});

	it('calls a pack without a loader vanilla, and writes no loader for one', async () => {
		const vanilla = { ...fields, loader: 'vanilla' as const, loaderVersion: null };
		expect(writeIndex(vanilla, []).dependencies).toEqual({ minecraft: '1.21.4' });
		expect(readMrpack(await pack({}, writeIndex(vanilla, [])))).toMatchObject({
			loader: 'vanilla',
			loaderVersion: null
		});
	});

	it('keeps client-only files with the rest', async () => {
		const files = [
			file('mods/a.jar'),
			file('mods/b.jar', 'unsupported'),
			file('mods/c.jar', 'optional')
		];
		const read = readMrpack(await pack({}, writeIndex(fields, files)));
		expect(read.files.map((f) => f.path)).toEqual(['mods/a.jar', 'mods/b.jar', 'mods/c.jar']);
	});

	it('gives the server one copy of each config file, server-overrides/ winning', async () => {
		const read = readMrpack(
			await pack({
				'overrides/config/a.toml': 'both',
				'server-overrides/config/a.toml': 'server',
				'overrides/config/b.toml': 'b',
				'client-overrides/options.txt': 'client'
			})
		);
		const text = (rel: string) => new TextDecoder().decode(read.read(read.overrides.get(rel)!));
		expect([...read.overrides.keys()].sort()).toEqual(['config/a.toml', 'config/b.toml']);
		expect(text('config/a.toml')).toBe('server');
		expect([...read.configs(['client-overrides']).keys()]).toEqual([
			'client-overrides/options.txt'
		]);
	});

	it('refuses a zip that is not a modpack, or an index of another format', async () => {
		expect(() => readMrpack(new Uint8Array())).toThrow();
		await expect(zipOf({ 'a.txt': 'x' }).then(readMrpack)).rejects.toThrow(
			/not a Modrinth modpack/
		);
		await expect(
			pack({}, { ...writeIndex(fields, []), formatVersion: 2 }).then(readMrpack)
		).rejects.toThrow(/Unsupported/);
	});
});
