import { randomBytes, createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';

import { CHUNK_BYTES } from '../upload-limits';
import { serverDir } from './instances';
import * as U from './uploads';

const USER = 1;
let id: number;
let root: string;
let outside: string;

const begin = (relPath: string, size: number, dirRel = '', userId = USER, instanceId = id) =>
	U.beginUpload({ instanceId, userId, dirRel, relPath, size });

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const slice = (data: Buffer, i: number) =>
	data.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, data.length));
const send = (
	uploadId: string,
	data: Buffer,
	i: number,
	extra: Partial<Parameters<typeof U.writePiece>[0]> = {}
) =>
	U.writePiece({
		uploadId,
		instanceId: id,
		userId: USER,
		index: i,
		piece: new Blob([new Uint8Array(slice(data, i))]),
		sha256: sha(slice(data, i)),
		...extra
	});

beforeEach(() => {
	U.sweepUploads();
	id = makeInstance().id;
	root = serverDir(id);
	mkdirSync(root, { recursive: true });
	outside = mkdtempSync(join(tmpdir(), 'outside-'));
	writeFileSync(join(outside, 'secret.txt'), 'SECRET');
});

describe('a normal upload', () => {
	it('accepts pieces in any order, even repeated, and assembles the exact file', async () => {
		const data = randomBytes(25 * 1024 * 1024);
		const session = begin('data/big.bin', data.length);
		expect(session.pieces).toBe(7);

		for (const i of [3, 0, 6, 1, 5, 2, 4]) await send(session.uploadId, data, i);
		await send(session.uploadId, data, 2); // again
		expect(U.uploadStatus(session.uploadId, id, USER).have).toHaveLength(7);

		expect(existsSync(join(root, 'data', 'big.bin'))).toBe(false); // not before finish
		expect(U.finishUpload(session.uploadId, id, USER)).toBe('data/big.bin');
		expect(readFileSync(join(root, 'data', 'big.bin')).equals(data)).toBe(true);
		expect(U._debug()).toEqual({ sessions: 0, files: 0 });
	});

	it('handles an empty file and an exact multiple of the piece size', async () => {
		const empty = begin('empty.bin', 0);
		await U.writePiece({
			uploadId: empty.uploadId,
			instanceId: id,
			userId: USER,
			index: 0,
			piece: new Blob([])
		});
		U.finishUpload(empty.uploadId, id, USER);
		expect(readFileSync(join(root, 'empty.bin')).length).toBe(0);

		const data = randomBytes(2 * CHUNK_BYTES);
		const exact = begin('exact.bin', data.length);
		expect(exact.pieces).toBe(2);
		await send(exact.uploadId, data, 1);
		await send(exact.uploadId, data, 0);
		U.finishUpload(exact.uploadId, id, USER);
		expect(readFileSync(join(root, 'exact.bin')).equals(data)).toBe(true);
	});

	it('replaces an existing file when it finishes', async () => {
		writeFileSync(join(root, 'replace.txt'), 'old');
		const s = begin('replace.txt', 3);
		await U.writePiece({
			uploadId: s.uploadId,
			instanceId: id,
			userId: USER,
			index: 0,
			piece: new Blob(['new'])
		});
		U.finishUpload(s.uploadId, id, USER);
		expect(readFileSync(join(root, 'replace.txt'), 'utf8')).toBe('new');
	});
});

describe('bad pieces', () => {
	it('refuses a piece of the wrong size or number, and a damaged one', async () => {
		const data = randomBytes(10 * 1024 * 1024);
		const s = begin('bad.bin', data.length);
		await expect(
			U.writePiece({
				uploadId: s.uploadId,
				instanceId: id,
				userId: USER,
				index: 0,
				piece: new Blob([data.subarray(0, 1000)])
			})
		).rejects.toThrow(/wrong size/);
		await expect(send(s.uploadId, data, 9)).rejects.toThrow(/Unexpected piece/);
		await expect(send(s.uploadId, data, 0, { sha256: 'ab'.repeat(32) })).rejects.toThrow(/damaged/);
		expect(U.uploadStatus(s.uploadId, id, USER).have).toEqual([]); // a damaged piece does not count
	});

	it('will not finish with a piece missing, but does once it arrives', async () => {
		const data = randomBytes(10 * 1024 * 1024);
		const s = begin('missing.bin', data.length);
		await send(s.uploadId, data, 1);
		expect(() => U.finishUpload(s.uploadId, id, USER)).toThrow(/incomplete/);
		await send(s.uploadId, data, 0);
		await send(s.uploadId, data, 2);
		U.finishUpload(s.uploadId, id, USER);
		expect(readFileSync(join(root, 'missing.bin')).equals(data)).toBe(true);
	});
});

describe('starting with a bad path or size', () => {
	it.each(['../x.bin', 'a/../../x.bin', '/etc/x.bin', 'C:\\x.bin'])('path %j', (path) => {
		expect(() => begin(path, 10)).toThrow();
	});

	it('refuses to go through, or into, a symlink pointing outside', () => {
		symlinkSync(outside, join(root, 'escape'));
		expect(() => begin('escape/x.bin', 10)).toThrow(/leaves the instance/);
		expect(() => begin('x.bin', 10, 'escape')).toThrow(/leaves the instance/);
	});

	it('refuses negative, fractional and over-limit sizes', () => {
		expect(() => begin('n.bin', -1)).toThrow(/size/);
		expect(() => begin('n.bin', 1.5)).toThrow(/size/);
		expect(() => begin('huge.bin', 11 * 1024 ** 3)).toThrow(/at most 10 GB/);
	});

	it('refuses a file larger than the free disk space', () => {
		expect(() => begin('disk.bin', 9 * 1024 ** 4)).toThrow(/at most|disk space/);
	});

	it('caps how many uploads can be in flight', () => {
		for (let i = 0; i < 32; i++) begin(`m${i}.bin`, 1);
		expect(() => begin('one-too-many.bin', 1)).toThrow(/Too many/);
	});
});

describe('a link appearing after the upload began', () => {
	it('is caught when the file is put in place, and nothing is written outside', async () => {
		const s = begin('later/sub/f.bin', 5); // `later` does not exist yet
		await U.writePiece({
			uploadId: s.uploadId,
			instanceId: id,
			userId: USER,
			index: 0,
			piece: new Blob(['12345'])
		});
		symlinkSync(outside, join(root, 'later'));
		expect(() => U.finishUpload(s.uploadId, id, USER)).toThrow(/leaves the instance/);
		expect(readdirSync(outside)).toEqual(['secret.txt']);
	});
});

describe('who may use an upload', () => {
	it('only the user and instance that started it', async () => {
		const s = begin('mine.bin', 5);
		const piece = new Blob(['12345']);
		const other = makeInstance().id;
		await expect(
			U.writePiece({ uploadId: s.uploadId, instanceId: id, userId: 2, index: 0, piece })
		).rejects.toThrow(/no longer available/);
		expect(() => U.finishUpload(s.uploadId, other, USER)).toThrow(/no longer available/);
		expect(() => U.abortUpload(s.uploadId, id, 2)).toThrow(/no longer available/);
		expect(() => U.uploadStatus('00000000-0000-0000-0000-000000000000', id, USER)).toThrow(
			/no longer available/
		);
	});
});

describe('abort and cleanup', () => {
	it('abort removes the temp file and the session', () => {
		const s = begin('a.bin', 5);
		expect(U._debug()).toEqual({ sessions: 1, files: 1 });
		U.abortUpload(s.uploadId, id, USER);
		expect(U._debug()).toEqual({ sessions: 0, files: 0 });
		expect(() => U.uploadStatus(s.uploadId, id, USER)).toThrow(/no longer available/);
	});

	it('discards uploads idle for an hour, and keeps newer ones', async () => {
		const s = begin('old.bin', 5);
		await U.writePiece({
			uploadId: s.uploadId,
			instanceId: id,
			userId: USER,
			index: 0,
			piece: new Blob(['12345'])
		});
		U.pruneUploads(Date.now() + 30 * 60_000);
		expect(U._debug().sessions).toBe(1);
		U.pruneUploads(Date.now() + 2 * 60 * 60_000);
		expect(U._debug()).toEqual({ sessions: 0, files: 0 });
	});

	it('the startup sweep clears leftovers', () => {
		begin('left.bin', 5);
		U.sweepUploads();
		expect(U._debug()).toEqual({ sessions: 0, files: 0 });
	});

	it('keeps half-sent files out of the instance folder', () => {
		begin('half.bin', 10);
		expect(readdirSync(root)).toEqual([]);
	});
});
