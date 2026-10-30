import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeInstance } from '#test/instance.js';
import { db } from './db';
import { installedMods } from './db/schema';
import { serverDir } from './instances';
import { listInstalled, modSupport, setEnabled } from './mods';

describe('modSupport', () => {
	it('knows which loaders run mods', () => {
		for (const loader of ['fabric', 'quilt', 'forge', 'neoforge', 'paper', 'purpur'])
			expect(modSupport(loader).supported).toBe(true);
		expect(modSupport('vanilla').supported).toBe(false);
		expect(modSupport('vanilla').loaders).toEqual([]);
	});

	it('lets Quilt run Fabric mods and Purpur run Paper-family plugins', () => {
		expect(modSupport('quilt').loaders).toEqual(['quilt', 'fabric']);
		expect(modSupport('purpur').loaders).toEqual(['purpur', 'paper', 'spigot', 'bukkit']);
		expect(modSupport('fabric').loaders).toEqual(['fabric']);
	});

	it('calls Paper-family jars plugins and puts them in plugins/', () => {
		expect(modSupport('paper')).toMatchObject({ noun: 'plugin', folder: 'plugins' });
		expect(modSupport('purpur')).toMatchObject({ noun: 'plugin', folder: 'plugins' });
		expect(modSupport('forge')).toMatchObject({ noun: 'mod', folder: 'mods' });
	});
});

describe('setEnabled', () => {
	let id: number;
	let modId: number;
	let root: string;

	beforeEach(() => {
		id = makeInstance({ loader: 'fabric' }).id;
		root = serverDir(id);
		mkdirSync(join(root, 'mods'), { recursive: true });
		writeFileSync(join(root, 'mods', 'sodium.jar'), 'jar');
		modId = db
			.insert(installedMods)
			.values({
				instanceId: id,
				source: 'modrinth',
				projectId: 'AANobbMI',
				versionId: 'v1',
				title: 'Sodium',
				versionNumber: '1.0',
				file: 'mods/sodium.jar'
			})
			.returning({ id: installedMods.id })
			.get().id;
	});

	it('renames the jar so the loader skips it, and back again', () => {
		setEnabled(id, modId, false);
		expect(existsSync(join(root, 'mods', 'sodium.jar'))).toBe(false);
		expect(existsSync(join(root, 'mods', 'sodium.jar.disabled'))).toBe(true);
		expect(listInstalled(id)[0]).toMatchObject({
			file: 'mods/sodium.jar.disabled',
			enabled: false
		});

		setEnabled(id, modId, true);
		expect(existsSync(join(root, 'mods', 'sodium.jar'))).toBe(true);
		expect(listInstalled(id)[0]).toMatchObject({ file: 'mods/sodium.jar', enabled: true });
	});

	it('does nothing when the mod is already in that state', () => {
		setEnabled(id, modId, true);
		expect(listInstalled(id)[0].file).toBe('mods/sodium.jar');
	});

	it('refuses to overwrite a file that is in the way', () => {
		writeFileSync(join(root, 'mods', 'sodium.jar.disabled'), 'other');
		expect(() => setEnabled(id, modId, false)).toThrow(/already exists/);
	});

	it('reports a jar that was deleted by hand', () => {
		rmSync(join(root, 'mods', 'sodium.jar'));
		expect(() => setEnabled(id, modId, false)).toThrow(/missing/);
	});

	it('leaves other instances alone', () => {
		const other = makeInstance({ loader: 'fabric' }).id;
		expect(() => setEnabled(other, modId, false)).toThrow(/Not installed/);
		expect(existsSync(join(root, 'mods', 'sodium.jar'))).toBe(true);
	});
});
