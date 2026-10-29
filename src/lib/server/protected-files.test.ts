import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeInstance } from '../../test/instance';
import * as F from './files';
import { serverDir } from './instances';
import { isProtected } from './protected-files';
import * as uploads from './uploads';

describe('isProtected', () => {
	it('covers the launcher files and the libraries folder, at the root only', () => {
		for (const p of [
			'server.jar',
			'eula.txt',
			'libraries',
			'libraries/net/x.jar',
			'forge-1.20-47.jar'
		])
			expect(isProtected(p), p).toBe(true);
		for (const p of [
			'mods/server.jar',
			'world',
			'server.properties',
			'forge-notes.txt',
			'config/eula.txt',
			''
		])
			expect(isProtected(p), p).toBe(false);
	});

	it('ignores case, trailing dots and spaces, and backslashes', () => {
		for (const p of ['SERVER.JAR', 'server.jar.', 'server.jar ', 'Libraries\\a\\b.jar'])
			expect(isProtected(p), p).toBe(true);
	});
});

let id: number;
let root: string;

beforeEach(() => {
	id = makeInstance().id;
	root = serverDir(id);
	mkdirSync(join(root, 'libraries'), { recursive: true });
	writeFileSync(join(root, 'server.jar'), 'JAR');
	writeFileSync(join(root, 'libraries/a.jar'), 'LIB');
	mkdirSync(join(root, 'mods'), { recursive: true });
	writeFileSync(join(root, 'mods/server.jar'), 'not the launcher');
});

describe('the file manager refuses to touch them', () => {
	it('delete', () => {
		expect(() => F.deleteEntry(id, 'server.jar')).toThrow(/cannot be deleted/);
		expect(() => F.deleteEntry(id, 'libraries')).toThrow(/cannot be deleted/);
		expect(() => F.deleteEntry(id, 'libraries/a.jar')).toThrow(/cannot be deleted/);
		expect(existsSync(join(root, 'server.jar'))).toBe(true);
		F.deleteEntry(id, 'mods/server.jar'); // same name elsewhere is fine
		expect(existsSync(join(root, 'mods/server.jar'))).toBe(false);
	});

	it('rename, from and onto a protected name', () => {
		expect(() => F.renameEntry(id, 'server.jar', 'old.jar')).toThrow(/cannot be renamed/);
		expect(() => F.renameEntry(id, 'libraries', 'lib')).toThrow(/cannot be renamed/);
		writeFileSync(join(root, 'other.jar'), 'x');
		expect(() => F.renameEntry(id, 'other.jar', 'SERVER.JAR')).toThrow(/cannot be replaced/);
		expect(readFileSync(join(root, 'server.jar'), 'utf8')).toBe('JAR');
	});

	it('creating a file or folder with a protected name', () => {
		expect(() => F.createTextFile(id, '', 'eula.txt')).toThrow(/cannot be replaced/);
		expect(() => F.makeDirectory(id, '', 'Libraries')).toThrow(/cannot be replaced/);
	});

	it('uploads onto them, small and chunked, also nested in a dropped folder', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'server.jar');
		await expect(F.saveUpload(id, '', file)).rejects.toThrow(/cannot be replaced/);
		await expect(F.saveUpload(id, '', new File(['x'], 'b.jar'), 'libraries/b.jar')).rejects.toThrow(
			/cannot be replaced/
		);
		expect(() =>
			uploads.beginUpload({
				instanceId: id,
				userId: 1,
				dirRel: '',
				relPath: 'server.jar',
				size: 10
			})
		).toThrow(/cannot be replaced/);
		expect(readFileSync(join(root, 'server.jar'), 'utf8')).toBe('JAR');
		await F.saveUpload(id, 'mods', new File(['ok'], 'server.jar')); // elsewhere: allowed
	});

	it('editing stays possible for text files such as eula.txt', () => {
		writeFileSync(join(root, 'eula.txt'), 'eula=false');
		F.writeTextFile(id, 'eula.txt', 'eula=true');
		expect(readFileSync(join(root, 'eula.txt'), 'utf8')).toBe('eula=true');
	});

	it('the listing marks them as locked', () => {
		const names = Object.fromEntries(
			F.listDirectory(id, '').entries.map((e) => [e.name, e.locked])
		);
		expect(names).toMatchObject({ 'server.jar': true, libraries: true, mods: false });
		expect(F.listDirectory(id, 'libraries').entries.every((e) => e.locked)).toBe(true);
	});
});
