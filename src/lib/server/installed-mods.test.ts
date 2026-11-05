import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';

import { db } from './db';
import { installedMods } from './db/schema';
import { enabledPath, forgetFiles, modRow, saveMods, setFileEnabled } from './installed-mods';
import { serverDir } from './instances';

const version = { id: 'v1', version_number: '1.0' };
const rowFiles = () =>
	db
		.select({ file: installedMods.file })
		.from(installedMods)
		.all()
		.map((r) => r.file);

describe('setFileEnabled', () => {
	it('renames a jar that has no row', () => {
		const { id } = makeInstance();
		writeFileSync(join(serverDir(id), 'a.jar'), 'a');
		setFileEnabled(id, 'a.jar', false);
		expect(existsSync(join(serverDir(id), 'a.jar'))).toBe(false);
		expect(existsSync(join(serverDir(id), 'a.jar.disabled'))).toBe(true);
	});

	it('keeps a row in step with its file', () => {
		const { id } = makeInstance();
		writeFileSync(join(serverDir(id), 'b.jar'), 'b');
		saveMods([modRow({ instanceId: id, projectId: 'P', version, file: 'b.jar', hash: 'h' })]);
		setFileEnabled(id, 'b.jar', false);
		expect(rowFiles()).toContain('b.jar.disabled');
		setFileEnabled(id, 'b.jar.disabled', true);
		expect(rowFiles()).toContain('b.jar');
	});

	it('leaves a file already in that state alone, and refuses a clash', () => {
		const { id } = makeInstance();
		writeFileSync(join(serverDir(id), 'c.jar'), 'c');
		writeFileSync(join(serverDir(id), 'c.jar.disabled'), 'old');
		setFileEnabled(id, 'c.jar', true);
		expect(() => setFileEnabled(id, 'c.jar', false)).toThrow('c.jar.disabled already exists');
		expect(() => setFileEnabled(id, 'gone.jar', false)).toThrow('gone.jar is missing');
	});
});

describe('forgetFiles', () => {
	it('drops a file in either state, and only for that instance', () => {
		const a = makeInstance();
		const b = makeInstance();
		const row = (instanceId: number, projectId: string, file: string) =>
			modRow({ instanceId, projectId, version, file, hash: 'h' });
		saveMods([
			row(a.id, 'P1', 'x.jar'),
			row(a.id, 'P2', 'y.jar.disabled'),
			row(b.id, 'P1', 'x.jar')
		]);
		forgetFiles(a.id, ['x.jar', 'y.jar']);
		expect(
			db
				.select()
				.from(installedMods)
				.all()
				.filter((r) => r.file === 'x.jar' || r.file === 'y.jar.disabled')
				.map((r) => r.instanceId)
		).toEqual([b.id]);
	});
});

describe('enabledPath', () => {
	it('strips the suffix only when it is there', () => {
		expect(enabledPath('a.jar.disabled')).toBe('a.jar');
		expect(enabledPath('a.jar')).toBe('a.jar');
	});
});
