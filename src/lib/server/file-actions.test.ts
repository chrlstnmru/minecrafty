import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeInstance } from '#test/instance.js';

import type { Actor } from './access';

import { claim } from './operations';

// Whether the server runs is decided per test; the runner itself is replaced.
const state = vi.hoisted(() => ({ running: false }));

vi.mock('./runner-client', () => ({
	status: async () =>
		state.running ? { state: 'running', pid: 1, startedAt: 0, exitCode: null } : null,
	send: async () => true,
	subscribe: async () => null
}));

const F = await import('./files');
const { serverDir } = await import('./instances');
const uploads = await import('./uploads');

const owner: Actor = { id: 1, role: 'owner' };
const member: Actor = { id: 2, role: 'user' };

let id: number;
let root: string;

beforeEach(() => {
	state.running = false;
	id = makeInstance().id;
	root = serverDir(id);
	mkdirSync(join(root, 'world'), { recursive: true });
	mkdirSync(join(root, 'config'), { recursive: true });
	writeFileSync(join(root, 'world/level.dat'), 'level');
	writeFileSync(join(root, 'server.jar'), 'JAR');
	writeFileSync(join(root, 'a.txt'), 'a');
});

const file = (name: string, text = 'x') => new File([text], name);

describe('code files belong to the owner', () => {
	it('saveFile', () => {
		expect(() => F.saveFile(member, id, 'user_jvm_args.txt', '-Xmx1G')).toThrow(/Only the owner/);
		expect(existsSync(join(root, 'user_jvm_args.txt'))).toBe(false);
		F.saveFile(owner, id, 'user_jvm_args.txt', '-Xmx1G');
		expect(readFileSync(join(root, 'user_jvm_args.txt'), 'utf8')).toBe('-Xmx1G');
		F.saveFile(member, id, 'config/a.toml', 'k = 1');
	});

	it('addFile', () => {
		expect(() => F.addFile(member, id, '', 'user_jvm_args.txt')).toThrow(/Only the owner/);
		F.addFile(owner, id, '', 'user_jvm_args.txt');
		expect(existsSync(join(root, 'user_jvm_args.txt'))).toBe(true);
	});

	it('moveEntry, by the new name', async () => {
		await expect(F.moveEntry(member, id, 'a.txt', 'user_jvm_args.txt')).rejects.toThrow(
			/Only the owner/
		);
		await F.moveEntry(member, id, 'a.txt', 'b.txt');
		expect(existsSync(join(root, 'b.txt'))).toBe(true);
	});

	it('assertMayUpload', async () => {
		await expect(F.assertMayUpload(member, id, 'mods', 'x.jar')).rejects.toThrow(/Only the owner/);
		await F.assertMayUpload(owner, id, 'mods', 'x.jar');
		await F.assertMayUpload(member, id, 'config', 'x.toml');
	});
});

describe('a running server keeps its world', () => {
	beforeEach(() => {
		state.running = true;
	});

	it('moveEntry, removeEntry and assertMayUpload refuse the world, and only the world', async () => {
		await expect(F.moveEntry(owner, id, 'world', 'old')).rejects.toThrow(/Stop the server/);
		await expect(F.removeEntry(id, 'world/level.dat')).rejects.toThrow(/Stop the server/);
		await expect(F.assertMayUpload(owner, id, 'world', 'x.dat')).rejects.toThrow(/Stop the server/);
		await F.removeEntry(id, 'a.txt');
		expect(existsSync(join(root, 'a.txt'))).toBe(false);
	});

	it('is fine again once it stops', async () => {
		state.running = false;
		await F.removeEntry(id, 'world/level.dat');
		expect(existsSync(join(root, 'world/level.dat'))).toBe(false);
	});
});

describe('nothing changes while the folder is being restored, installed or updated', () => {
	const refuse = async (run: () => unknown, message: RegExp) => {
		await expect(Promise.resolve().then(run)).rejects.toThrow(message);
	};

	it('during a restore', async () => {
		const release = claim(id, 'restore');
		try {
			const m = /restore is in progress/;
			await refuse(() => F.saveFile(owner, id, 'a.txt', 'x'), m);
			await refuse(() => F.addFolder(id, '', 'new'), m);
			await refuse(() => F.addFile(owner, id, '', 'b.txt'), m);
			await refuse(() => F.moveEntry(owner, id, 'a.txt', 'c.txt'), m);
			await refuse(() => F.removeEntry(id, 'a.txt'), m);
			await refuse(() => F.assertMayUpload(owner, id, '', 'u.txt'), m);
			await refuse(
				() => F.uploadFiles(owner, id, '', [{ file: file('u.txt'), path: 'u.txt' }], () => {}),
				m
			);
			expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a');
		} finally {
			release();
		}
		F.saveFile(owner, id, 'a.txt', 'x');
	});

	it('during an install or update', async () => {
		const busy = makeInstance({ installState: 'installing' }).id;
		await refuse(() => F.saveFile(owner, busy, 'a.txt', 'x'), /install or update/);
		await refuse(() => F.removeEntry(busy, 'a.txt'), /install or update/);
	});
});

describe('removeEntry', () => {
	it('still refuses the files the server cannot start without', async () => {
		await expect(F.removeEntry(id, 'server.jar')).rejects.toThrow(/cannot be deleted/);
		expect(existsSync(join(root, 'server.jar'))).toBe(true);
	});
});

describe('saveFiles', () => {
	const hashOf = (rel: string) => F.readTextFile(id, rel).hash;

	it('saves several files together and hands back what each reads as now', async () => {
		writeFileSync(join(root, 'config/b.toml'), 'k = 1');
		const result = await F.saveFiles(member, id, [
			{ rel: 'a.txt', content: 'a!', baseHash: hashOf('a.txt') },
			{ rel: 'config/b.toml', content: 'k = 1', baseHash: hashOf('config/b.toml') }
		]);
		expect(result.changed).toBe(1);
		expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a!');
		expect(result.hashes['a.txt']).toBe(hashOf('a.txt'));
		expect(result.hashes['config/b.toml']).toBe(hashOf('config/b.toml'));
	});

	it('writes nothing when one file changed since it was opened, and says which', async () => {
		const a = hashOf('a.txt');
		writeFileSync(join(root, 'config/b.toml'), 'k = 1');
		const b = hashOf('config/b.toml');
		writeFileSync(join(root, 'config/b.toml'), 'changed by someone else');
		await expect(
			F.saveFiles(owner, id, [
				{ rel: 'a.txt', content: 'a!', baseHash: a },
				{ rel: 'config/b.toml', content: 'mine', baseHash: b }
			])
		).rejects.toThrow('config/b.toml: This file changed since you opened it');
		expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a');
	});

	it('names the refused path, and says when a file changed since it was opened', async () => {
		await expect(
			F.saveFiles(owner, id, [{ rel: 'a.txt', content: 'a!', baseHash: 'f'.repeat(40) }])
		).rejects.toMatchObject({ path: 'a.txt', kind: 'stale' });
		await expect(F.removeEntries(id, ['a.txt', 'gone.txt'])).rejects.toMatchObject({
			path: 'gone.txt',
			kind: 'refused'
		});
		await expect(F.moveEntries(owner, id, ['config'], 'config')).rejects.toMatchObject({
			path: 'config',
			kind: 'refused'
		});
		await expect(F.moveEntries(owner, id, ['a.txt', 'server.jar'], 'config')).rejects.toMatchObject(
			{ path: 'server.jar', kind: 'refused' }
		);
	});

	it('refuses a code file for a member, a missing file, a type it cannot edit and a repeat, before writing', async () => {
		writeFileSync(join(root, 'user_jvm_args.txt'), '-Xmx1G');
		const a = hashOf('a.txt');
		await expect(
			F.saveFiles(member, id, [
				{ rel: 'a.txt', content: 'a!', baseHash: a },
				{ rel: 'user_jvm_args.txt', content: '-Xmx9G', baseHash: hashOf('user_jvm_args.txt') }
			])
		).rejects.toThrow(/user_jvm_args.txt: Only the owner/);
		await expect(
			F.saveFiles(owner, id, [{ rel: 'gone.txt', content: 'x', baseHash: a }])
		).rejects.toThrow('gone.txt: This file changed since you opened it');
		await expect(
			F.saveFiles(owner, id, [{ rel: 'server.jar', content: 'x', baseHash: a }])
		).rejects.toThrow('server.jar: This file type cannot be edited');
		await expect(
			F.saveFiles(owner, id, [
				{ rel: 'a.txt', content: '1', baseHash: a },
				{ rel: 'a.txt', content: '2', baseHash: a }
			])
		).rejects.toThrow('a.txt: is in the list twice');
		expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a');
		expect(readFileSync(join(root, 'user_jvm_args.txt'), 'utf8')).toBe('-Xmx1G');
	});

	it('is refused while the folder is being restored', async () => {
		const release = claim(id, 'restore');
		try {
			await expect(
				F.saveFiles(owner, id, [{ rel: 'a.txt', content: 'x', baseHash: hashOf('a.txt') }])
			).rejects.toThrow(/restore is in progress/);
		} finally {
			release();
		}
	});
});

describe('removeEntries', () => {
	it('deletes files and folders together, a file in a chosen folder counted with it', async () => {
		writeFileSync(join(root, 'config/b.toml'), 'k');
		expect(await F.removeEntries(id, ['config', 'config/b.toml', 'a.txt'])).toBe(2);
		expect(existsSync(join(root, 'config'))).toBe(false);
		expect(existsSync(join(root, 'a.txt'))).toBe(false);
		expect(existsSync(join(root, 'world/level.dat'))).toBe(true);
	});

	it('deletes nothing when one is protected, missing or in a world a running server keeps', async () => {
		await expect(F.removeEntries(id, ['a.txt', 'server.jar'])).rejects.toThrow(
			/server.jar: .*cannot be deleted/
		);
		await expect(F.removeEntries(id, ['a.txt', 'nope.txt'])).rejects.toThrow('nope.txt: not found');
		await expect(F.removeEntries(id, [])).rejects.toThrow('Choose');
		state.running = true;
		await expect(F.removeEntries(id, ['a.txt', 'world/level.dat'])).rejects.toThrow(
			/world\/level.dat: .*Stop the server/
		);
		expect(existsSync(join(root, 'a.txt'))).toBe(true);
		expect(existsSync(join(root, 'world/level.dat'))).toBe(true);
	});
});

describe('moveEntries', () => {
	it('moves files and folders into a folder, and to the server folder, as one step', async () => {
		mkdirSync(join(root, 'mods'), { recursive: true });
		writeFileSync(join(root, 'config/b.toml'), 'k');
		expect(await F.moveEntries(member, id, ['a.txt', 'config'], 'mods')).toBe(2);
		expect(existsSync(join(root, 'mods/a.txt'))).toBe(true);
		expect(existsSync(join(root, 'mods/config/b.toml'))).toBe(true);
		expect(existsSync(join(root, 'a.txt'))).toBe(false);
		expect(await F.moveEntries(member, id, ['mods/a.txt'], '')).toBe(1);
		expect(existsSync(join(root, 'a.txt'))).toBe(true);
		// already there: nothing to do
		expect(await F.moveEntries(member, id, ['a.txt'], '')).toBe(0);
	});

	it('moves nothing when a name is taken, an item goes into itself, or one is protected or missing', async () => {
		mkdirSync(join(root, 'mods'), { recursive: true });
		writeFileSync(join(root, 'mods/a.txt'), 'other');
		await expect(F.moveEntries(member, id, ['a.txt', 'config'], 'mods')).rejects.toThrow(
			/a.txt: mods\/a.txt already exists/
		);
		await expect(F.moveEntries(member, id, ['config'], 'config/sub')).rejects.toThrow(
			'config: cannot be moved into itself'
		);
		await expect(F.moveEntries(member, id, ['server.jar'], 'mods')).rejects.toThrow(
			/server.jar: .*cannot be moved/
		);
		await expect(F.moveEntries(member, id, ['nope'], 'mods')).rejects.toThrow('nope: not found');
		await expect(F.moveEntries(member, id, ['a.txt'], 'server.jar')).rejects.toThrow('is a file');
		expect(existsSync(join(root, 'a.txt'))).toBe(true);
		expect(existsSync(join(root, 'config'))).toBe(true);
	});

	it('keeps the code rule for what is inside a folder that moves, and the running world', async () => {
		mkdirSync(join(root, 'staging'), { recursive: true });
		mkdirSync(join(root, 'mods'), { recursive: true });
		writeFileSync(join(root, 'staging/evil.jar'), 'JAR');
		await expect(F.moveEntries(member, id, ['staging'], 'mods')).rejects.toThrow(
			/staging: Only the owner/
		);
		expect(existsSync(join(root, 'staging/evil.jar'))).toBe(true);
		await F.moveEntries(owner, id, ['staging'], 'mods');
		expect(existsSync(join(root, 'mods/staging/evil.jar'))).toBe(true);

		state.running = true;
		await expect(F.moveEntries(owner, id, ['world'], 'mods')).rejects.toThrow(/Stop the server/);
		await expect(F.moveEntries(owner, id, ['a.txt'], 'world')).rejects.toThrow(/Stop the server/);
	});
});

describe('describeSelection', () => {
	it('names each entry by its path in the server folder, folders with their contents', () => {
		writeFileSync(join(root, 'config/b.toml'), 'k');
		const { entries, name } = F.describeSelection(id, ['config', 'a.txt', 'config/b.toml']);
		expect(name).toBe('files.zip');
		expect(entries.map((e) => `${e.kind}:${e.name}`).sort()).toEqual([
			'dir:config',
			'file:a.txt',
			'file:config/b.toml'
		]);
		expect(() => F.describeSelection(id, ['nope'])).toThrow('nope not found');
		expect(() => F.describeSelection(id, [])).toThrow('Choose');
		expect(() => F.describeSelection(id, ['../x'])).toThrow(/not allowed/);
	});
});

describe('uploadFiles', () => {
	it('refuses a batch with a code file before writing any of it', async () => {
		const saved: string[] = [];
		await expect(
			F.uploadFiles(
				member,
				id,
				'config',
				[
					{ file: file('ok.toml'), path: 'ok.toml' },
					{ file: file('evil.jar'), path: 'evil.jar' }
				],
				(p) => saved.push(p)
			)
		).rejects.toThrow(/Only the owner/);
		expect(saved).toEqual([]);
		expect(existsSync(join(root, 'config/ok.toml'))).toBe(false);
	});

	it('reports each file as it lands', async () => {
		const saved: string[] = [];
		await F.uploadFiles(
			member,
			id,
			'config',
			[
				{ file: file('one.toml', '1'), path: 'one.toml' },
				{ file: file('two.toml', '2'), path: 'sub/two.toml' }
			],
			(p) => saved.push(p)
		);
		expect(saved).toEqual(['one.toml', 'sub/two.toml']);
		expect(readFileSync(join(root, 'config/sub/two.toml'), 'utf8')).toBe('2');
	});

	it('stops at a world file while the server runs, keeping what already landed', async () => {
		state.running = true;
		const saved: string[] = [];
		await expect(
			F.uploadFiles(
				owner,
				id,
				'',
				[
					{ file: file('one.txt'), path: 'one.txt' },
					{ file: file('x.dat'), path: 'world/x.dat' }
				],
				(p) => saved.push(p)
			)
		).rejects.toThrow(/Stop the server/);
		expect(saved).toEqual(['one.txt']);
	});
});

describe('a chunked upload is checked again when it finishes', () => {
	it('knows where an upload is headed', () => {
		const { uploadId } = uploads.beginUpload({
			instanceId: id,
			userId: member.id,
			dirRel: 'config',
			relPath: 'big.toml',
			size: 10
		});
		expect(uploads.pendingTarget(uploadId, id, member.id)).toEqual({
			dirRel: 'config',
			relPath: 'big.toml'
		});
		expect(() => uploads.pendingTarget(uploadId, id, owner.id)).toThrow(/no longer available/);
		uploads.abortUpload(uploadId, id, member.id);
	});

	it('so a server that started meanwhile blocks a world upload', async () => {
		await F.assertMayUpload(owner, id, 'world', 'big.dat');
		state.running = true;
		await expect(F.assertMayUpload(owner, id, 'world', 'big.dat')).rejects.toThrow(
			/Stop the server/
		);
	});
});
