import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeInstance } from '#test/instance.js';
import type { Actor } from './access';

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

describe('removeEntry', () => {
	it('still refuses the files the server cannot start without', async () => {
		await expect(F.removeEntry(id, 'server.jar')).rejects.toThrow(/cannot be deleted/);
		expect(existsSync(join(root, 'server.jar'))).toBe(true);
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
